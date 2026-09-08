import * as THREE from 'three';

export class F1RacingSim {
  constructor(waypointsData) {
    this.waypointsData = waypointsData;
    this.curve = null;
    this.trackLength = 0;
    this.cars = [];
    this.simSpeed = 1.0;
    this.isPaused = false;
    
    this.initCurve();
  }

  initCurve() {
    const rawPts = this.waypointsData.waypoints;
    // Map Blender (x, y, z) to Three.js coordinates: (x, z, -y)
    const points = rawPts.map(wp => new THREE.Vector3(wp.x, wp.z + 0.15, -wp.y));
    
    this.curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.15);
    this.trackLength = this.curve.getLength();
    console.log(`F1 Track Spline initialized. Length: ${this.trackLength.toFixed(1)} meters`);
  }

  addCar(config) {
    // config: { id, name, team, number, color, modelGroup, initialProgress, laneOffset, targetPace }
    const car = {
      id: config.id,
      name: config.name,
      team: config.team,
      number: config.number,
      color: config.color,
      badgeColor: config.badgeColor || config.color,
      modelGroup: config.modelGroup,
      
      // Simulation state
      progress: config.initialProgress || 0.0,
      laneOffset: config.laneOffset || 0.0,
      targetLaneOffset: config.laneOffset || 0.0,
      
      speed: 160.0, // km/h
      targetSpeed: 200.0,
      rpm: 8000,
      gear: 4,
      throttle: 0.8,
      brake: 0.0,
      drsActive: false,
      drsAvailable: false,
      ersCharge: 88.0, // %
      
      // Strategy & Pace
      paceMode: 'balanced', // 'conserve', 'balanced', 'attack'
      tireCompound: config.tireCompound || 'SOFT',
      tireWear: 96.0, // %
      
      // Lap telemetry
      lap: 1,
      currentLapTime: 0.0,
      lastLapTime: null,
      bestLapTime: null,
      position: config.initialPosition || 1,
      intervalToLeader: 0.0,
      
      // Visuals
      wheelAngle: 0.0,
      steerAngle: 0.0,
      rollAngle: 0.0
    };

    this.cars.push(car);
    return car;
  }

  setPaceMode(carId, mode) {
    const car = this.cars.find(c => c.id === carId);
    if (car) {
      car.paceMode = mode;
    }
  }

  setSimSpeed(mult) {
    this.simSpeed = mult;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  update(deltaSeconds) {
    if (this.isPaused || deltaSeconds <= 0) return;
    
    // Scale delta by sim speed, clamp to prevent physics explosion
    const dt = Math.min(deltaSeconds * this.simSpeed, 0.2);

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      this.updateCarPhysics(car, dt);
    }

    // Sort positions by lap + progress
    this.cars.sort((a, b) => {
      const scoreA = a.lap + a.progress;
      const scoreB = b.lap + b.progress;
      return scoreB - scoreA;
    });

    const leader = this.cars[0];
    for (let i = 0; i < this.cars.length; i++) {
      this.cars[i].position = i + 1;
      if (i === 0) {
        this.cars[i].intervalToLeader = 0.0;
      } else {
        // Estimate gap in seconds
        const distDiff = (leader.lap + leader.progress - (this.cars[i].lap + this.cars[i].progress)) * this.trackLength;
        const avgSpeedMs = Math.max(this.cars[i].speed / 3.6, 25.0);
        this.cars[i].intervalToLeader = (distDiff / avgSpeedMs);
      }
    }
  }

  updateCarPhysics(car, dt) {
    const u = car.progress;
    
    // Sample upcoming curve curvature to determine braking / apex speed
    const lookaheadU = (u + 0.02) % 1.0;
    const currentTangent = this.curve.getTangentAt(u);
    const futureTangent = this.curve.getTangentAt(lookaheadU);
    
    // Curvature estimate
    const turnAngle = currentTangent.angleTo(futureTangent);
    const isStraight = turnAngle < 0.08;
    const isHeavyBrakingZone = turnAngle > 0.35;
    
    // Base cornering speed vs straight line speed (km/h)
    let maxCornerSpeed = 330.0;
    if (turnAngle > 0.45) maxCornerSpeed = 105.0; // Hairpin / Tight chicane
    else if (turnAngle > 0.25) maxCornerSpeed = 160.0; // Medium corner
    else if (turnAngle > 0.12) maxCornerSpeed = 230.0; // Fast sweeper
    
    // Pace mode adjustments
    let paceMultiplier = 1.0;
    if (car.paceMode === 'attack') paceMultiplier = 1.08;
    if (car.paceMode === 'conserve') paceMultiplier = 0.92;

    // DRS zones (e.g. Main Straight Y: -160 to +80 => Three.js Z: -80 to +160, and Back Straight)
    const pCenter = this.curve.getPointAt(u);
    const isMainStraightDRS = (pCenter.x > -15 && pCenter.x < 15 && pCenter.z > -60 && pCenter.z < 120);
    const isBackStraightDRS = (pCenter.x > 120 && pCenter.x < 210 && pCenter.z > -160 && pCenter.z < 30);
    
    car.drsAvailable = (isMainStraightDRS || isBackStraightDRS);
    car.drsActive = car.drsAvailable && (car.speed > 250);

    let targetSpeed = maxCornerSpeed * paceMultiplier;
    if (car.drsActive) {
      targetSpeed += 22.0; // DRS speed boost
    }

    // Anti-collision following distance & traffic queue management
    for (const other of this.cars) {
      if (other.id === car.id) continue;
      const distProgress = (other.progress - car.progress + 1.0) % 1.0;
      const distMeters = distProgress * this.trackLength;
      const lateralDist = Math.abs(car.laneOffset - other.laneOffset);

      // If directly behind in same lane
      if (distMeters > 0.05 && distMeters < 9.5 && lateralDist < 1.8) {
        const safeSpeed = Math.max(40.0, other.speed * Math.min(1.0, distMeters / 9.5));
        targetSpeed = Math.min(targetSpeed, safeSpeed);
      }
    }

    // Accelerate / Brake with realistic F1 dynamics
    if (car.speed < targetSpeed) {
      const accelRate = (car.speed < 180 ? 65.0 : 35.0) * (car.paceMode === 'attack' ? 1.2 : 1.0);
      car.speed += accelRate * dt;
      if (car.speed > targetSpeed) car.speed = targetSpeed;
      car.throttle = 1.0;
      car.brake = 0.0;
    } else {
      const brakeRate = 120.0; // High braking downforce
      car.speed -= brakeRate * dt;
      if (car.speed < targetSpeed) car.speed = targetSpeed;
      car.throttle = 0.1;
      car.brake = 0.9;
    }

    // Advance progress along track: ds = v * dt
    const speedMs = car.speed / 3.6;
    const progressDelta = (speedMs * dt) / this.trackLength;
    const oldProgress = car.progress;
    car.progress = (car.progress + progressDelta) % 1.0;

    // Lap timer & crossing start/finish line
    car.currentLapTime += dt;
    if (car.progress < oldProgress) {
      car.lap += 1;
      car.lastLapTime = car.currentLapTime;
      if (!car.bestLapTime || car.lastLapTime < car.bestLapTime) {
        car.bestLapTime = car.lastLapTime;
      }
      car.currentLapTime = 0.0;
    }

    // Calculate Gears & RPM
    this.updateGearsAndRpm(car);

    // Tire degradation & ERS charge
    const wearRate = (car.paceMode === 'attack' ? 0.25 : (car.paceMode === 'conserve' ? 0.08 : 0.15)) * dt;
    car.tireWear = Math.max(15.0, car.tireWear - wearRate);
    
    if (car.brake > 0.5) {
      car.ersCharge = Math.min(100.0, car.ersCharge + 12.0 * dt); // MGU-K regen under braking
    } else if (car.paceMode === 'attack' && car.speed > 240) {
      car.ersCharge = Math.max(5.0, car.ersCharge - 8.0 * dt); // ERS deployment
    }

    // Dynamic Overtaking Lane Changes
    this.updateOvertakingAI(car, dt);

    // Update 3D Model position, heading, banking, and wheel animations
    this.applyModelTransform(car, dt, currentTangent, futureTangent);
  }

  updateGearsAndRpm(car) {
    const s = car.speed;
    let gear = 1;
    let gearMin = 0;
    let gearMax = 80;

    if (s < 80) { gear = 1; gearMin = 0; gearMax = 80; }
    else if (s < 125) { gear = 2; gearMin = 75; gearMax = 125; }
    else if (s < 165) { gear = 3; gearMin = 120; gearMax = 165; }
    else if (s < 205) { gear = 4; gearMin = 160; gearMax = 205; }
    else if (s < 245) { gear = 5; gearMin = 200; gearMax = 245; }
    else if (s < 280) { gear = 6; gearMin = 240; gearMax = 280; }
    else if (s < 315) { gear = 7; gearMin = 275; gearMax = 315; }
    else { gear = 8; gearMin = 310; gearMax = 360; }

    car.gear = gear;
    const gearFrac = Math.max(0, Math.min(1, (s - gearMin) / (gearMax - gearMin)));
    car.rpm = Math.round(7500 + gearFrac * 5000);
  }

  updateOvertakingAI(car, dt) {
    // Check proximity to other cars
    for (const other of this.cars) {
      if (other.id === car.id) continue;
      
      const distForward = ((other.progress - car.progress + 1.0) % 1.0) * this.trackLength;
      const distBackward = ((car.progress - other.progress + 1.0) % 1.0) * this.trackLength;
      const distAlong = Math.min(distForward, distBackward);
      const lateralDist = Math.abs(car.laneOffset - other.laneOffset);

      // 1. Slipstream pull-out & overtake
      if (distForward > 1.0 && distForward < 35.0 && car.speed >= other.speed * 0.98) {
        if (lateralDist < 2.0) {
          const preferredSide = other.laneOffset > 0 ? -2.2 : 2.2;
          car.targetLaneOffset = preferredSide;
        }
      }

      // 2. Side-by-side wheel-to-wheel lateral separation (cars within 7.0m along track)
      if (distAlong < 7.0 && lateralDist < 2.2) {
        const pushDir = car.laneOffset >= other.laneOffset ? 1 : -1;
        car.targetLaneOffset = other.laneOffset + pushDir * 2.3;
      }
    }

    // Clamp target lane offset to stay cleanly within track width
    car.targetLaneOffset = Math.max(-3.6, Math.min(3.6, car.targetLaneOffset));

    // Smooth lane offset transition
    if (Math.abs(car.laneOffset - car.targetLaneOffset) > 0.02) {
      const step = Math.sign(car.targetLaneOffset - car.laneOffset) * 2.8 * dt;
      car.laneOffset += step;
    }
  }

  applyModelTransform(car, dt, currentTangent, futureTangent) {
    if (!car.modelGroup) return;

    // Centerline position
    const centerPos = this.curve.getPointAt(car.progress);
    
    // Track normal in XZ plane
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3().crossVectors(currentTangent, up).normalize();
    
    // Final position with lane offset
    const finalPos = centerPos.clone().addScaledVector(normal, car.laneOffset);
    car.modelGroup.position.copy(finalPos);

    // Orientation: Forward vector
    const lookTarget = finalPos.clone().add(currentTangent);
    car.modelGroup.lookAt(lookTarget);

    // Centrifugal banking roll into corners
    const crossY = currentTangent.x * futureTangent.z - currentTangent.z * futureTangent.x;
    const targetRoll = -crossY * (car.speed / 120.0) * 0.8;
    car.rollAngle += (targetRoll - car.rollAngle) * 5.0 * dt;
    car.modelGroup.rotateZ(car.rollAngle);

    // Wheels rotation animation
    const wheelRadius = 0.36; // F1 18-inch Pirelli wheels
    const wheelAngularSpeed = (car.speed / 3.6) / wheelRadius;
    car.wheelAngle += wheelAngularSpeed * dt;

    // Rotate internal wheel meshes if present
    car.modelGroup.traverse(child => {
      const name = child.name.toLowerCase();
      if (name.includes('wheel') || name.includes('tire') || name.includes('rad') || name.includes('tyre')) {
        child.rotation.x = car.wheelAngle;
      }
    });
  }
}
