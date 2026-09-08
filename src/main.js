import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { F1RacingSim } from './racingSim.js';
import { F1CameraController } from './camera.js';
import { F1Minimap } from './minimap.js';
import { F1AudioEngine } from './audio.js';

class F1App {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.progressFill = document.getElementById('progress-fill');
    this.loadingStatus = document.getElementById('loading-status');

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();

    // Lighting
    this.sunLight = null;
    this.ambientLight = null;
    this.hemiLight = null;
    this.floodLights = [];
    this.todIndex = 0;
    this.todPresets = [
      { name: "Day", icon: "☀️", sunColor: 0xffffff, sunIntensity: 2.8, skyColor: 0x88ccee, groundColor: 0x334433, ambient: 1.0, fogColor: 0xd8e8f8, bg: 0x98c8f0 },
      { name: "Sunset", icon: "🌅", sunColor: 0xff7733, sunIntensity: 3.5, skyColor: 0xff9955, groundColor: 0x331822, ambient: 1.2, fogColor: 0x3d1a24, bg: 0x2e121c },
      { name: "Night", icon: "🌙", sunColor: 0x5588cc, sunIntensity: 1.5, skyColor: 0x223366, groundColor: 0x111828, ambient: 1.5, fogColor: 0x0c1426, bg: 0x080e1c }
    ];

    // Subsystems
    this.THREE = THREE;
    this.sim = null;
    this.cameraController = null;
    this.minimap = null;
    this.audio = new F1AudioEngine();

    this.init();
  }

  async init() {
    this.setupThree();
    this.setupLighting();
    this.setupSkyAndEnvironment();

    try {
      // 1. Load Waypoints JSON
      this.updateProgress(15, "Lade Strecken-Geometrie & Ideallinie...");
      const waypointsRes = await fetch('/track_waypoints.json');
      const waypointsData = await waypointsRes.json();
      
      this.sim = new F1RacingSim(waypointsData);
      this.cameraController = new F1CameraController(this.camera, this.renderer.domElement, this.sim);
      
      const minimapCanvas = document.getElementById('minimap-canvas');
      this.minimap = new F1Minimap(minimapCanvas, waypointsData, this.sim);

      // 2. Load Track GLB
      this.updateProgress(40, "Lade Blender F1 Grand Prix Rennstrecke...");
      const loader = new GLTFLoader();
      const trackGltf = await this.loadModelAsync(loader, '/f1_track.glb');
      
      this.processTrackMesh(trackGltf.scene);
      this.scene.add(trackGltf.scene);

      // 3. Load 3D F1 Cars
      this.updateProgress(65, "Lade Red Bull Racing RB20...");
      const rbGltf = await this.loadModelAsync(loader, '/cars/car_mercedes.glb');
      const rbGroup = this.normalizeAndPrepareCar(rbGltf.scene, "redbull", 5.4, false);
      this.scene.add(rbGroup);
      
      this.sim.addCar({
        id: 'redbull',
        name: 'M. Verstappen',
        team: 'Red Bull Racing #1',
        number: 1,
        color: '#0055ff',
        badgeColor: '#001a30',
        modelGroup: rbGroup,
        wheelMeshes: rbGroup.wheelMeshes,
        initialProgress: 0.05,
        laneOffset: -1.8,
        tireCompound: 'SOFT',
        initialPosition: 1
      });

      this.updateProgress(82, "Lade Aston Martin Aramco AMR24...");
      const ferrariGltf = await this.loadModelAsync(loader, '/cars/car_ferrari.glb');
      const ferrariGroup = this.normalizeAndPrepareCar(ferrariGltf.scene, "ferrari", 5.5, false);
      this.scene.add(ferrariGroup);
      
      this.sim.addCar({
        id: 'ferrari',
        name: 'F. Alonso',
        team: 'Aston Martin #14',
        number: 14,
        color: '#00594f',
        badgeColor: '#00594f',
        modelGroup: ferrariGroup,
        wheelMeshes: ferrariGroup.wheelMeshes,
        initialProgress: 0.038,
        laneOffset: 1.8,
        tireCompound: 'MEDIUM',
        initialPosition: 2
      });

      this.updateProgress(95, "Lade Mercedes-AMG W15...");
      const mercGltf = await this.loadModelAsync(loader, '/cars/car_mercedes.glb');
      const mercGroup = this.normalizeAndPrepareCar(mercGltf.scene, "mercedes", 5.5, false);
      this.scene.add(mercGroup);
      
      this.sim.addCar({
        id: 'mercedes',
        name: 'L. Hamilton',
        team: 'Mercedes-AMG #44',
        number: 44,
        color: '#00f0ff',
        badgeColor: '#00a19c',
        modelGroup: mercGroup,
        wheelMeshes: mercGroup.wheelMeshes,
        initialProgress: 0.024,
        laneOffset: -1.0,
        tireCompound: 'HARD',
        initialPosition: 3
      });

      this.updateProgress(100, "Startaufstellung bereit!");
      setTimeout(() => {
        this.loadingOverlay.style.opacity = '0';
        this.loadingOverlay.style.pointerEvents = 'none';
        setTimeout(() => this.loadingOverlay.style.display = 'none', 600);
      }, 500);

      this.setupUI();
      this.animate();

    } catch (err) {
      console.error("Error loading 3D assets:", err);
      this.loadingStatus.innerHTML = `<span style="color:#ff3333">Fehler beim Laden: ${err.message}</span>`;
    }
  }

  updateProgress(pct, statusText) {
    if (this.progressFill) this.progressFill.style.width = `${pct}%`;
    if (this.loadingStatus) this.loadingStatus.innerText = statusText;
  }

  loadModelAsync(loader, url) {
    return new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
  }

  setupThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x98c8f0);
    this.scene.fog = new THREE.FogExp2(0xd8e8f8, 0.0012);

    // near: 0.35 gives 7x higher depth precision than 0.05, eliminating all track polygon flickering
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.35, 1200);
    this.camera.position.set(25, 30, -15);

    // logarithmicDepthBuffer guarantees zero z-fighting across huge open-world track distances
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      precision: 'highp'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setupLighting() {
    // Hemisphere ambient light
    this.hemiLight = new THREE.HemisphereLight(0x88ccee, 0x334433, 1.0);
    this.scene.add(this.hemiLight);

    // Directional sunlight - optimized 1024 shadow map for fluid 60+ FPS
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.8);
    this.sunLight.position.set(120, 220, 140);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 600;
    
    const d = 260;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0002;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight);

    // Stadium Floodlight Accents around track (10 towers matching circuit positions)
    const floodlightSpots = [
      new THREE.Vector3(-25.0, 22.0, 110.0),
      new THREE.Vector3(-25.0, 22.0, 20.0),
      new THREE.Vector3(-30.0, 22.0, -90.0),
      new THREE.Vector3(35.0, 22.0, -160.0),
      new THREE.Vector3(120.0, 24.0, -290.0),
      new THREE.Vector3(255.0, 25.0, -200.0),
      new THREE.Vector3(265.0, 24.0, -50.0),
      new THREE.Vector3(175.0, 22.5, 90.0),
      new THREE.Vector3(70.0, 22.0, 260.0),
      new THREE.Vector3(-90.0, 22.0, 170.0)
    ];

    floodlightSpots.forEach(pos => {
      const pl = new THREE.PointLight(0xfff0dd, 0, 160, 1.6);
      pl.position.copy(pos);
      pl.visible = false; // Start inactive in Day mode to prevent GPU shader looping
      this.scene.add(pl);
      this.floodLights.push(pl);
    });
  }

  setupSkyAndEnvironment() {
    // Ground horizon extension
    const groundGeo = new THREE.PlaneGeometry(1600, 1600);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x182c12,
      roughness: 0.95,
      metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  processTrackMesh(trackScene) {
    trackScene.traverse(child => {
      if (child.isMesh) {
        const matName = child.material ? (child.material.name || '').toLowerCase() : '';
        const objName = (child.name || '').toLowerCase();

        // Only vertical structures should cast shadows, ground surfaces only receive shadows!
        const isGroundSurface = matName.includes('asphalt') || matName.includes('grass') || 
                               matName.includes('gravel') || matName.includes('runoff') || 
                               matName.includes('kerb') || matName.includes('curb') ||
                               matName.includes('line') || matName.includes('grid') ||
                               objName.includes('terrain') || objName.includes('track') ||
                               objName.includes('kerb') || objName.includes('curb') ||
                               objName.includes('line') || objName.includes('runoff');
        
        child.castShadow = !isGroundSurface;
        child.receiveShadow = true;
        
        // Enhance materials & prevent all z-fighting / polygon flickering
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => {
            m.depthWrite = true;
            m.depthTest = true;

            // Track asphalt base
            if (matName.includes('asphalt') || objName.includes('track_surface')) {
              m.roughness = 0.82;
              m.metalness = 0.05;
              m.polygonOffset = false;
            }
            // Painted white lines & starting grid slots: push forward in depth to prevent flickering
            else if (matName.includes('line') || matName.includes('white') || matName.includes('grid') ||
                     objName.includes('line') || objName.includes('grid') || objName.includes('mark')) {
              m.roughness = 0.55;
              m.polygonOffset = true;
              m.polygonOffsetFactor = -2.5;
              m.polygonOffsetUnits = -2.5;
            }
            // 3D Kerbs: push forward
            else if (matName.includes('kerb') || matName.includes('curb') || objName.includes('kerb') || objName.includes('curb')) {
              m.roughness = 0.45;
              m.polygonOffset = true;
              m.polygonOffsetFactor = -1.8;
              m.polygonOffsetUnits = -1.8;
            }
            // Runoff & Gravel
            else if (matName.includes('runoff') || matName.includes('gravel') || objName.includes('runoff') || objName.includes('gravel')) {
              m.polygonOffset = true;
              m.polygonOffsetFactor = -1.0;
              m.polygonOffsetUnits = -1.0;
            }
            // Concrete barriers & walls
            else if (matName.includes('wall') || matName.includes('concrete')) {
              m.roughness = 0.7;
            }
            // Metal gantries & armco
            else if (matName.includes('gantry') || matName.includes('armco')) {
              m.metalness = 0.85;
              m.roughness = 0.35;
            }
            // Surrounding terrain grass: push backward
            else if (objName.includes('terrain') || matName.includes('grass')) {
              m.polygonOffset = true;
              m.polygonOffsetFactor = 1.0;
              m.polygonOffsetUnits = 1.0;
            }
          });
        }
      }
    });
  }

  normalizeAndPrepareCar(carScene, carType, targetLength = 5.4, invertForward = false) {
    // 1. Orient carScene so that nose points forward along +Z, roof along +Y, width along X
    if (invertForward) {
      carScene.rotation.y = Math.PI;
    }
    carScene.updateMatrixWorld(true);

    // 2. Measure oriented bounding box
    const box = new THREE.Box3().setFromObject(carScene);
    const size = new THREE.Vector3();
    box.getSize(size);

    // True FIA F1 Car dimensions: Length ~5.40m, Width ~2.05m, Height ~1.05m
    const targetW = 2.05;
    const targetH = 1.05;
    const targetL = targetLength;

    const scaleX = targetW / size.x;
    const scaleY = targetH / size.y;
    const scaleZ = targetL / size.z;
    carScene.scale.set(scaleX, scaleY, scaleZ);
    carScene.updateMatrixWorld(true);

    // 3. Recompute bounding box after scaling and center precisely at origin
    box.setFromObject(carScene);
    const center = new THREE.Vector3();
    box.getCenter(center);

    carScene.position.x = -center.x;
    carScene.position.z = -center.z;
    carScene.position.y = -box.min.y;
    carScene.updateMatrixWorld(true);

    const wrapper = new THREE.Group();
    wrapper.add(carScene);

    // Cache wheel meshes for zero-overhead animation
    const wheelMeshes = [];

    // 4. Enhance materials for solid, crisp, realistic F1 bodywork and liveries
    carScene.traverse(child => {
      if (child.isMesh) {
        const name = (child.name || '').toLowerCase();
        if (name.includes('wheel') || name.includes('tire') || name.includes('rad') || name.includes('tyre')) {
          wheelMeshes.push(child);
        }

        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(mat => {
            mat.transparent = false;
            mat.opacity = 1.0;
            mat.depthWrite = true;
            mat.depthTest = true;
            mat.side = THREE.DoubleSide;
            if (carType === 'redbull') {
              mat.color.setHex(0x0a2458); // Rich Red Bull Racing matte midnight navy blue
              mat.roughness = 0.38;
              mat.metalness = 0.35;
            } else {
              mat.roughness = 0.45;
              mat.metalness = 0.25;
            }
            mat.needsUpdate = true;
          });
        }
      }
    });

    wrapper.wheelMeshes = wheelMeshes;
    return wrapper;
  }

  setupUI() {
    // Sim Speed
    const btnSpeed = document.getElementById('btn-speed');
    const speedLabel = document.getElementById('speed-label');
    let speedIndex = 0;
    const speeds = [1.0, 2.0, 4.0];
    btnSpeed.addEventListener('click', () => {
      speedIndex = (speedIndex + 1) % speeds.length;
      const spd = speeds[speedIndex];
      this.sim.setSimSpeed(spd);
      speedLabel.innerText = `${spd}x Speed`;
    });

    // Pause / Play
    const btnPause = document.getElementById('btn-pause');
    const pauseIcon = document.getElementById('pause-icon');
    btnPause.addEventListener('click', () => {
      const isPaused = this.sim.togglePause();
      pauseIcon.innerText = isPaused ? '▶️' : '⏸️';
    });

    // Time of Day
    const btnTod = document.getElementById('btn-tod');
    const todIcon = document.getElementById('tod-icon');
    const todLabel = document.getElementById('tod-label');
    btnTod.addEventListener('click', () => {
      this.todIndex = (this.todIndex + 1) % this.todPresets.length;
      const tod = this.todPresets[this.todIndex];
      todIcon.innerText = tod.icon;
      todLabel.innerText = tod.name;
      this.applyTimeOfDay(tod);
    });

    // Audio Mute/Unmute
    const btnSound = document.getElementById('btn-sound');
    const soundIcon = document.getElementById('sound-icon');
    const soundLabel = document.getElementById('sound-label');
    btnSound.addEventListener('click', () => {
      const isAudible = this.audio.toggleMute();
      soundIcon.innerText = isAudible ? '🔊' : '🔇';
      soundLabel.innerText = isAudible ? 'Sound ON' : 'Sound OFF';
      btnSound.classList.toggle('active', isAudible);
    });

    // Overview focus
    const btnOverview = document.getElementById('btn-overview');
    btnOverview.addEventListener('click', () => {
      this.cameraController.focusOnTrack();
      this.updateActiveCamBtn('orbit');
    });

    // Driver Selection Cards
    const driverCards = document.querySelectorAll('.driver-card');
    driverCards.forEach(card => {
      card.addEventListener('click', () => {
        driverCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const carId = card.getAttribute('data-car');
        this.cameraController.selectCar(carId);
      });
    });

    // Strategy Pace Buttons
    const paceButtons = document.querySelectorAll('.pace-btn');
    paceButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        paceButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const pace = btn.getAttribute('data-pace');
        const activeCarId = this.cameraController.selectedCarId;
        this.sim.setPaceMode(activeCarId, pace);
      });
    });

    // Camera Toolbar Buttons
    const camButtons = document.querySelectorAll('.cam-btn');
    camButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        camButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const camMode = btn.getAttribute('data-cam');
        this.cameraController.setMode(camMode);
        
        const hint = document.getElementById('inspection-hint');
        hint.style.opacity = (camMode === 'orbit') ? '1' : '0';
      });
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === '1') this.switchCamera('orbit');
      if (e.key === '2') this.switchCamera('clash');
      if (e.key === '3') this.switchCamera('chase');
      if (e.key === '4') this.switchCamera('cockpit');
      if (e.key === '5') this.switchCamera('tv');
      if (e.key === '6') this.switchCamera('drone');
      if (e.code === 'Space') btnPause.click();
      if (e.key === 'm' || e.key === 'M') btnSound.click();
      if (e.key === 'o' || e.key === 'O') btnOverview.click();
      if (e.key === 'Tab') {
        e.preventDefault();
        this.cycleSelectedCar();
      }
    });
  }

  switchCamera(mode) {
    this.cameraController.setMode(mode);
    this.updateActiveCamBtn(mode);
    const hint = document.getElementById('inspection-hint');
    if (hint) hint.style.opacity = (mode === 'orbit') ? '1' : '0';
  }

  updateActiveCamBtn(mode) {
    document.querySelectorAll('.cam-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-cam') === mode);
    });
  }

  cycleSelectedCar() {
    const cars = ['redbull', 'ferrari', 'mercedes'];
    const currentIdx = cars.indexOf(this.cameraController.selectedCarId);
    const nextCarId = cars[(currentIdx + 1) % cars.length];
    
    document.querySelectorAll('.driver-card').forEach(card => {
      card.classList.toggle('selected', card.getAttribute('data-car') === nextCarId);
    });
    this.cameraController.selectCar(nextCarId);
  }

  applyTimeOfDay(tod) {
    this.sunLight.color.setHex(tod.sunColor);
    this.sunLight.intensity = tod.sunIntensity;
    this.hemiLight.color.setHex(tod.skyColor);
    this.hemiLight.groundColor.setHex(tod.groundColor);
    this.hemiLight.intensity = tod.ambient;
    this.scene.background.setHex(tod.bg);
    this.scene.fog.color.setHex(tod.fogColor);

    // Floodlight activation during night and sunset; completely hide during day to save GPU cycles
    const isLit = tod.name === "Night" || tod.name === "Sunset";
    const floodIntensity = tod.name === "Night" ? 220.0 : (tod.name === "Sunset" ? 60.0 : 0.0);
    this.floodLights.forEach(fl => {
      fl.visible = isLit;
      fl.intensity = floodIntensity;
      fl.distance = 280;
    });
  }

  updatePerformanceStats(dt) {
    this.frameCount = (this.frameCount || 0) + 1;
    this.fpsTimeAcc = (this.fpsTimeAcc || 0) + dt;

    if (this.fpsTimeAcc >= 0.4) {
      const fps = Math.min(144, Math.round(this.frameCount / this.fpsTimeAcc));
      const ms = (this.fpsTimeAcc / this.frameCount * 1000).toFixed(1);
      
      if (this.dom && this.dom.perfFps) this.dom.perfFps.innerText = `${fps} FPS`;
      if (this.dom && this.dom.perfMs) this.dom.perfMs.innerText = `${ms} ms`;
      if (this.dom && this.dom.perfDot) {
        if (fps >= 48) {
          this.dom.perfDot.style.backgroundColor = 'var(--accent-green)';
          this.dom.perfDot.style.boxShadow = '0 0 8px var(--accent-green)';
        } else if (fps >= 28) {
          this.dom.perfDot.style.backgroundColor = 'var(--accent-yellow)';
          this.dom.perfDot.style.boxShadow = '0 0 8px var(--accent-yellow)';
        } else {
          this.dom.perfDot.style.backgroundColor = 'var(--f1-red)';
          this.dom.perfDot.style.boxShadow = '0 0 8px var(--f1-red)';
        }
      }

      this.frameCount = 0;
      this.fpsTimeAcc = 0;
    }
  }

  updateHUD() {
    if (!this.dom) {
      this.dom = {
        speed: document.getElementById('telemetry-speed'),
        gear: document.getElementById('telemetry-gear'),
        rpm: document.getElementById('telemetry-rpm'),
        drs: document.getElementById('telemetry-drs'),
        tireText: document.getElementById('tire-wear-text'),
        tireBar: document.getElementById('tire-wear-bar'),
        ersText: document.getElementById('ers-charge-text'),
        ersBar: document.getElementById('ers-charge-bar'),
        lap: document.getElementById('lap-counter'),
        gaps: {
          redbull: document.getElementById('gap-redbull'),
          ferrari: document.getElementById('gap-ferrari'),
          mercedes: document.getElementById('gap-mercedes')
        },
        perfFps: document.getElementById('perf-fps'),
        perfMs: document.getElementById('perf-ms'),
        perfDot: document.getElementById('perf-dot')
      };
    }

    const activeCar = this.sim.cars.find(c => c.id === this.cameraController.selectedCarId) || this.sim.cars[0];
    if (!activeCar) return;

    // Cockpit Speed & Gear
    if (this.dom.speed) this.dom.speed.innerText = Math.round(activeCar.speed);
    if (this.dom.gear) this.dom.gear.innerText = activeCar.gear;
    if (this.dom.rpm) this.dom.rpm.innerText = activeCar.rpm.toLocaleString();

    if (this.dom.drs) {
      if (activeCar.drsActive) {
        this.dom.drs.className = "drs-badge active";
        this.dom.drs.innerText = "DRS OPEN";
      } else if (activeCar.drsAvailable) {
        this.dom.drs.className = "drs-badge";
        this.dom.drs.style.color = "#00f0ff";
        this.dom.drs.innerText = "DRS READY";
      } else {
        this.dom.drs.className = "drs-badge";
        this.dom.drs.style.color = "rgba(255,255,255,0.4)";
        this.dom.drs.innerText = "DRS";
      }
    }

    // Strategy stats
    if (this.dom.tireText) this.dom.tireText.innerText = `${Math.round(activeCar.tireWear)}%`;
    if (this.dom.tireBar) this.dom.tireBar.style.width = `${Math.round(activeCar.tireWear)}%`;
    if (this.dom.ersText) this.dom.ersText.innerText = `${Math.round(activeCar.ersCharge)}%`;
    if (this.dom.ersBar) this.dom.ersBar.style.width = `${Math.round(activeCar.ersCharge)}%`;

    // Leaderboard gaps & lap counter
    if (this.dom.lap) this.dom.lap.innerText = `Lap ${activeCar.lap}/5`;

    for (const car of this.sim.cars) {
      const gapEl = this.dom.gaps[car.id];
      if (gapEl) {
        if (car.position === 1) {
          gapEl.innerText = "LEADER";
          gapEl.style.color = "var(--accent-yellow)";
        } else {
          gapEl.innerText = `+${car.intervalToLeader.toFixed(3)}s`;
          gapEl.style.color = "#ffffff";
        }
      }
    }

    // Engine Audio updates
    this.audio.update(activeCar.speed, activeCar.rpm, activeCar.gear, activeCar.brake > 0.4);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.1);

    // Update real-time performance counter
    this.updatePerformanceStats(dt);

    if (this.sim) {
      this.sim.update(dt);
    }

    if (this.cameraController) {
      this.cameraController.update(dt);
    }

    if (this.minimap) {
      this.minimap.draw();
    }

    // Throttle DOM updates to ~15 Hz (every 66ms) to avoid browser layout thrashing & stutter
    this.hudTimer = (this.hudTimer || 0) + dt;
    if (this.hudTimer >= 0.066) {
      this.updateHUD();
      this.hudTimer = 0;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Start application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.__f1app = new F1App();
});
