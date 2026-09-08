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
    // Track surface is at z=0.0. Car bounding box bottom is at y=0.0.
    // +0.035 places tires flush on the asphalt without floating.
    const points = rawPts.map(wp => new THREE.Vector3(wp.x, wp.z + 0.035, -wp.y));
    
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
    
    // Multi-point lookahead: immediate apex and upcoming braking zone
    const lookaheadShort = (u + 0.018) % 1.0;
    const lookaheadLong = (u + 0.055) % 1.0;
    const currentTangent = this.curve.getTangentAt(u);
    const shortTangent = this.curve.getTangentAt(lookaheadShort);
    const longTangent = this.curve.getTangentAt(lookaheadLong);
    
    // Curvature estimate with anticipatory turn detection
    const shortTurn = currentTangent.angleTo(shortTangent);
    const longTurn = currentTangent.angleTo(longTangent);
    const turnAngle = Math.max(shortTurn, longTurn * 0.85);
    
    // Smooth continuous cornering speed (km/h) - no jerky threshold jumps!
    // turnAngle 0.0 -> ~335 km/h (straight)
    // turnAngle 0.2 -> ~210 km/h (sweeper)
    // turnAngle 0.4 -> ~145 km/h (medium)
    // turnAngle > 0.6 -> ~105 km/h (hairpin / chicane)
    const curveIntensity = Math.min(1.0, turnAngle / 0.52);
    const baseCornerSpeed = 335.0 - Math.pow(curveIntensity, 0.75) * 225.0;
    
    // Pace mode adjustments
    let paceMultiplier = 1.0;
    if (car.paceMode === 'attack') paceMultiplier = 1.08;
    if (car.paceMode === 'conserve') paceMultiplier = 0.92;

    // DRS zones (Main Straight & Back Straight)
    const pCenter = this.curve.getPointAt(u);
    const isMainStraightDRS = (pCenter.x > -15 && pCenter.x < 15 && pCenter.z > -60 && pCenter.z < 120);
    const isBackStraightDRS = (pCenter.x > 120 && pCenter.x < 210 && pCenter.z > -160 && pCenter.z < 30);
    
    car.drsAvailable = (isMainStraightDRS || isBackStraightDRS);
    car.drsActive = car.drsAvailable && (car.speed > 240);

    let targetSpeed = baseCornerSpeed * paceMultiplier;
    if (car.drsActive) {
      targetSpeed += 22.0; // DRS speed boost
    }

    // Anti-collision following distance & queue management
    for (const other of this.cars) {
      if (other.id === car.id) continue;
      const distProgress = (other.progress - car.progress + 1.0) % 1.0;
      const distMeters = distProgress * this.trackLength;
      const lateralDist = Math.abs(car.laneOffset - other.laneOffset);

      // If directly behind in same lane
      if (distMeters > 0.05 && distMeters < 9.5 && lateralDist < 1.8) {
        const safeSpeed = Math.max(45.0, other.speed * Math.min(1.0, distMeters / 9.5));
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

    // Update 3D Model position, heading, and wheel animations
    this.applyModelTransform(car, dt, currentTangent);
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
      if (distForward > 1.5 && distForward < 35.0 && car.speed >= other.speed * 0.97) {
        if (lateralDist < 2.0) {
          const preferredSide = other.laneOffset > 0 ? -2.2 : 2.2;
          car.targetLaneOffset = preferredSide;
        }
      }

      // 2. Side-by-side wheel-to-wheel lateral separation (cars within 7.5m along track)
      if (distAlong < 7.5 && lateralDist < 2.2) {
        const pushDir = car.laneOffset >= other.laneOffset ? 1 : -1;
        car.targetLaneOffset = other.laneOffset + pushDir * 2.3;
      }
    }

    // Clamp target lane offset to stay cleanly within track width
    car.targetLaneOffset = Math.max(-3.5, Math.min(3.5, car.targetLaneOffset));

    // Smooth critically-damped lane offset transition (no jerky linear steps)
    const laneDiff = car.targetLaneOffset - car.laneOffset;
    const blend = 1.0 - Math.exp(-3.2 * dt);
    car.laneOffset += laneDiff * blend;
  }

  applyModelTransform(car, dt, currentTangent) {
    if (!car.modelGroup) return;

    // Centerline position
    const centerPos = this.curve.getPointAt(car.progress);
    
    // Track normal in XZ plane
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3().crossVectors(currentTangent, up).normalize();
    
    // Final position with lane offset - strictly grounded on track
    const finalPos = centerPos.clone().addScaledVector(normal, car.laneOffset);
    car.modelGroup.position.copy(finalPos);

    // Realistic steering yaw into lane changes:
    // When moving laterally to change lanes, the car's nose smoothly aims slightly into the new lane,
    // then straightens back out along currentTangent when lane transition finishes.
    const laneDiff = car.targetLaneOffset - car.laneOffset;
    const lateralSteer = Math.max(-0.25, Math.min(0.25, laneDiff * 0.14));
    const heading = currentTangent.clone().addScaledVector(normal, lateralSteer).normalize();

    const lookTarget = finalPos.clone().add(heading);
    car.modelGroup.lookAt(lookTarget);

    // NO ROLL: Formula 1 cars have ultra-stiff suspensions and stay 100% flat on the asphalt.
    // Setting roll to 0.0 guarantees that all 4 wheels remain completely grounded without lifting off!
    car.rollAngle = 0.0;

    // Wheels rotation animation
    const wheelRadius = 0.36; // F1 18-inch Pirelli wheels
    const wheelAngularSpeed = (car.speed / 3.6) / wheelRadius;
    car.wheelAngle += wheelAngularSpeed * dt;

    // Fast rotation of cached wheel meshes without full hierarchy traverse
    if (car.wheelMeshes && car.wheelMeshes.length > 0) {
      for (let i = 0; i < car.wheelMeshes.length; i++) {
        car.wheelMeshes[i].rotation.x = car.wheelAngle;
      }
    } else if (car.modelGroup) {
      // Fallback: cache wheel meshes once
      car.wheelMeshes = [];
      car.modelGroup.traverse(child => {
        const name = child.name.toLowerCase();
        if (name.includes('wheel') || name.includes('tire') || name.includes('rad') || name.includes('tyre')) {
          car.wheelMeshes.push(child);
          child.rotation.x = car.wheelAngle;
        }
      });
    }
  }
}
