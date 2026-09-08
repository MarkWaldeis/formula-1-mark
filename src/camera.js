import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class F1CameraController {
  constructor(camera, domElement, sim) {
    this.camera = camera;
    this.domElement = domElement;
    this.sim = sim;
    
    this.mode = 'orbit'; // 'orbit', 'clash', 'chase', 'cockpit', 'tv', 'drone'
    this.selectedCarId = 'redbull';
    
    // Orbit controls for free inspection
    this.orbitControls = new OrbitControls(this.camera, this.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbitControls.minDistance = 3.0;
    this.orbitControls.maxDistance = 750.0;
    
    // Default starting view: Start/Finish straight & grandstand
    this.camera.position.set(30.0, 42.0, -10.0);
    this.orbitControls.target.set(0.0, 5.0, 25.0);
    this.orbitControls.update();

    // TV Broadcast Trackside Elevated Camera Posts
    this.tvCameras = [
      { name: "Main Straight Gantry", pos: new THREE.Vector3(22.0, 24.0, 30.0) },
      { name: "Turn 1 Braking Tower", pos: new THREE.Vector3(-32.0, 26.0, -100.0) },
      { name: "Curva Grande High-Speed Crane", pos: new THREE.Vector3(75.0, 32.0, -260.0) },
      { name: "Lesmo Infield Camera", pos: new THREE.Vector3(190.0, 28.0, -130.0) },
      { name: "Back Straight DRS Tower", pos: new THREE.Vector3(125.0, 25.0, 90.0) },
      { name: "Ascari Chicane Flyover", pos: new THREE.Vector3(60.0, 28.0, 240.0) },
      { name: "Parabolica Stadium Post", pos: new THREE.Vector3(-55.0, 26.0, 180.0) }
    ];
    this.currentTvIndex = 0;
    this.droneAngle = 0.0;
  }

  setMode(mode) {
    this.mode = mode;
    this.orbitControls.enabled = (mode === 'orbit');
    
    if (mode === 'clash') {
      this.camera.fov = 40;
      this.camera.near = 0.5;
    } else if (mode === 'cockpit') {
      this.camera.fov = 70;
      this.camera.near = 0.05;
    } else if (mode === 'chase') {
      this.camera.fov = 62;
      this.camera.near = 0.1;
    } else if (mode === 'tv') {
      this.camera.fov = 32;
      this.camera.near = 0.5;
    } else {
      this.camera.fov = 55;
      this.camera.near = 0.1;
    }
    this.camera.updateProjectionMatrix();

    if (mode === 'orbit') {
      const car = this.sim.cars.find(c => c.id === this.selectedCarId) || this.sim.cars[0];
      if (car && car.modelGroup) {
        const p = car.modelGroup.position;
        this.orbitControls.target.set(p.x, p.y + 1.0, p.z);
        this.camera.position.set(p.x + 6.0, p.y + 3.5, p.z - 7.0);
        this.orbitControls.update();
      }
    }
  }

  selectCar(carId) {
    this.selectedCarId = carId;
    const car = this.sim.cars.find(c => c.id === carId);
    if (car && car.modelGroup && this.mode === 'orbit') {
      const p = car.modelGroup.position;
      this.orbitControls.target.set(p.x, p.y + 1.0, p.z);
      this.camera.position.set(p.x + 6.0, p.y + 3.5, p.z - 7.0);
      this.orbitControls.update();
    }
  }

  focusOnTrack() {
    this.setMode('orbit');
    this.orbitControls.target.set(80.0, 5.0, 0.0);
    this.camera.position.set(80.0, 320.0, 360.0);
    this.orbitControls.update();
  }

  update(dt) {
    const car = this.sim.cars.find(c => c.id === this.selectedCarId) || this.sim.cars[0];
    if (!car || !car.modelGroup) {
      if (this.mode === 'orbit') this.orbitControls.update();
      return;
    }

    const carPos = car.modelGroup.position.clone();
    const carRot = car.modelGroup.rotation;
    
    // In Three.js, Object3D.lookAt(target) sets local +Z to point towards target
    const forward = new THREE.Vector3(0, 0, 1).applyEuler(carRot).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyEuler(carRot).normalize();

    if (this.mode === 'orbit') {
      this.orbitControls.update();
    } 
    else if (this.mode === 'clash') {
      // F1 Clash isometric tactical camera smoothly trailing the pack
      const clashOffset = new THREE.Vector3(-24.0, 36.0, -24.0);
      const targetPos = carPos.clone().add(clashOffset);
      this.camera.position.lerp(targetPos, 8.0 * dt);
      this.camera.lookAt(carPos.clone().add(new THREE.Vector3(0, 1.2, 0)));
    } 
    else if (this.mode === 'chase') {
      // Third-person dynamic chase camera trailing behind the rear wing
      const targetCamPos = carPos.clone().addScaledVector(forward, -9.0).addScaledVector(up, 3.2);
      this.camera.position.lerp(targetCamPos, 14.0 * dt);
      
      const lookTarget = carPos.clone().addScaledVector(forward, 15.0).addScaledVector(up, 0.8);
      this.camera.lookAt(lookTarget);
    } 
    else if (this.mode === 'cockpit') {
      // Onboard T-Cam mounted on the roll-hoop airbox looking forward down over the halo and nosecone
      const cockpitOffset = forward.clone().multiplyScalar(-0.30).add(up.clone().multiplyScalar(1.25));
      this.camera.position.copy(carPos.clone().add(cockpitOffset));
      
      const lookTarget = carPos.clone().add(forward.clone().multiplyScalar(35.0)).add(up.clone().multiplyScalar(0.70));
      this.camera.lookAt(lookTarget);
    } 
    else if (this.mode === 'tv') {
      // Select closest broadcast tower
      let bestDist = Infinity;
      let bestIndex = this.currentTvIndex;

      for (let i = 0; i < this.tvCameras.length; i++) {
        const d = this.tvCameras[i].pos.distanceTo(carPos);
        if (d > 30 && d < 180 && d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }

      this.currentTvIndex = bestIndex;
      const tvCam = this.tvCameras[this.currentTvIndex];
      this.camera.position.lerp(tvCam.pos, 5.0 * dt);
      this.camera.lookAt(carPos.clone().add(new THREE.Vector3(0, 1.2, 0)));
    } 
    else if (this.mode === 'drone') {
      // Cinematic aerial drone rotating smoothly around the car
      this.droneAngle += 0.5 * dt;
      const droneRadius = 24.0;
      const droneHeight = 15.0;
      
      const droneX = carPos.x + Math.cos(this.droneAngle) * droneRadius;
      const droneZ = carPos.z + Math.sin(this.droneAngle) * droneRadius;
      const droneY = carPos.y + droneHeight;
      
      this.camera.position.lerp(new THREE.Vector3(droneX, droneY, droneZ), 6.0 * dt);
      this.camera.lookAt(carPos.clone().add(new THREE.Vector3(0, 1.2, 0)));
    }
  }
}
