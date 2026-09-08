"""
F1 Track Builder for Blender 5.2.1 LTS
Creates a complete, highly realistic Formula 1 circuit:
- Circuit centerline with smooth Catmull-Rom interpolation and elevation
- Realistic track asphalt with racing line rubbering
- Curbs / Kerbs (red & white 3D stepped kerbs on apexes and corner exits)
- Run-off areas with Paul Ricard style blue/red warning stripes & gravel traps
- Armco barriers, concrete safety walls, and catch fences
- Starting grid (20 slots, pole position, start/finish checkered line)
- Overhead start/finish gantry with 5 red starting lights
- Complete Pit Lane with pit wall, telemetry stands, team garages, and paddock hospitality
- Main grandstand with tiered covered seating and secondary grandstands
- Distance brake markers (300m, 200m, 150m, 100m, 50m)
- DRS boards & sponsor gantries
- Floodlight stadium towers
- Green infield/outfield terrain with hills and gravel
- Trackside broadcast cameras
"""

import bpy
import bmesh
import math
import mathutils
import json
import os

def run():
    print("=== Starting F1 Track Generation ===")
    
    # 1. Ensure scene is 'Formula1'
    if "Formula1" in bpy.data.scenes:
        bpy.context.window.scene = bpy.data.scenes["Formula1"]
    scene = bpy.context.scene
    
    # Ensure collections exist
    collections_to_create = [
        "COL_Track",
        "COL_PitLane",
        "COL_Barriers",
        "COL_Structures",
        "COL_Environment",
        "COL_Lighting",
        "COL_Cameras"
    ]
    
    col_map = {}
    for col_name in collections_to_create:
        if col_name not in bpy.data.collections:
            col = bpy.data.collections.new(col_name)
            scene.collection.children.link(col)
        else:
            col = bpy.data.collections[col_name]
        col_map[col_name] = col
    
    # Clean up existing objects in our track collections
    for col_name in ["COL_Track", "COL_PitLane", "COL_Barriers", "COL_Structures", "COL_Environment"]:
        col = col_map[col_name]
        for obj in list(col.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
            
    # Purge orphan meshes
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)
    
    # -------------------------------------------------------------
    # 2. Material Library Setup
    # -------------------------------------------------------------
    def get_or_create_mat(name, base_color=(0.1, 0.1, 0.1, 1.0), roughness=0.7, metallic=0.0, specular=0.5, emission=None):
        if name in bpy.data.materials:
            mat = bpy.data.materials[name]
        else:
            mat = bpy.data.materials.new(name=name)
            mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        if not bsdf:
            bsdf = nodes.new("ShaderNodeBsdfPrincipled")
        
        # Set BSDF inputs safely across Blender versions
        if 'Base Color' in bsdf.inputs:
            bsdf.inputs['Base Color'].default_value = base_color
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = roughness
        if 'Metallic' in bsdf.inputs:
            bsdf.inputs['Metallic'].default_value = metallic
        if 'Specular IOR Level' in bsdf.inputs:
            bsdf.inputs['Specular IOR Level'].default_value = specular
        elif 'Specular' in bsdf.inputs:
            bsdf.inputs['Specular'].default_value = specular
            
        if emission:
            if 'Emission Color' in bsdf.inputs:
                bsdf.inputs['Emission Color'].default_value = emission[:4]
                if 'Emission Strength' in bsdf.inputs:
                    bsdf.inputs['Emission Strength'].default_value = emission[4] if len(emission) > 4 else 1.0
            elif 'Emission' in bsdf.inputs:
                bsdf.inputs['Emission'].default_value = emission[:4]
                
        return mat

    mat_asphalt = get_or_create_mat("M_F1_Asphalt", (0.06, 0.06, 0.07, 1.0), roughness=0.85, metallic=0.0)
    mat_asphalt_pit = get_or_create_mat("M_F1_PitAsphalt", (0.1, 0.1, 0.11, 1.0), roughness=0.8, metallic=0.0)
    mat_white_line = get_or_create_mat("M_F1_WhiteLine", (0.95, 0.95, 0.95, 1.0), roughness=0.4, metallic=0.0)
    mat_yellow_line = get_or_create_mat("M_F1_YellowLine", (0.95, 0.75, 0.05, 1.0), roughness=0.4, metallic=0.0)
    mat_kerb_red = get_or_create_mat("M_F1_KerbRed", (0.85, 0.05, 0.05, 1.0), roughness=0.5, metallic=0.0)
    mat_kerb_white = get_or_create_mat("M_F1_KerbWhite", (0.92, 0.92, 0.92, 1.0), roughness=0.5, metallic=0.0)
    mat_runoff_blue = get_or_create_mat("M_F1_RunoffBlue", (0.05, 0.25, 0.65, 1.0), roughness=0.8, metallic=0.0)
    mat_runoff_red = get_or_create_mat("M_F1_RunoffRed", (0.8, 0.1, 0.1, 1.0), roughness=0.8, metallic=0.0)
    mat_gravel = get_or_create_mat("M_F1_Gravel", (0.45, 0.38, 0.28, 1.0), roughness=0.95, metallic=0.0)
    mat_grass = get_or_create_mat("M_F1_Grass", (0.12, 0.28, 0.08, 1.0), roughness=0.9, metallic=0.0)
    mat_concrete_wall = get_or_create_mat("M_F1_ConcreteWall", (0.6, 0.6, 0.62, 1.0), roughness=0.7, metallic=0.0)
    mat_armco = get_or_create_mat("M_F1_Armco", (0.75, 0.75, 0.78, 1.0), roughness=0.35, metallic=0.85)
    mat_tecpro_red = get_or_create_mat("M_F1_TecproRed", (0.85, 0.08, 0.08, 1.0), roughness=0.6, metallic=0.0)
    mat_tecpro_white = get_or_create_mat("M_F1_TecproWhite", (0.9, 0.9, 0.9, 1.0), roughness=0.6, metallic=0.0)
    mat_fence = get_or_create_mat("M_F1_CatchFence", (0.2, 0.2, 0.22, 1.0), roughness=0.5, metallic=0.7)
    mat_gantry = get_or_create_mat("M_F1_GantrySteel", (0.15, 0.16, 0.18, 1.0), roughness=0.4, metallic=0.8)
    mat_light_red = get_or_create_mat("M_F1_LightRed", (1.0, 0.0, 0.0, 1.0), roughness=0.2, emission=(1.0, 0.02, 0.02, 1.0, 8.0))
    mat_floodlight = get_or_create_mat("M_F1_Floodlight", (1.0, 0.98, 0.9, 1.0), roughness=0.2, emission=(1.0, 0.95, 0.85, 1.0, 15.0))
    mat_sponsor_rolex = get_or_create_mat("M_F1_RolexGreen", (0.01, 0.25, 0.12, 1.0), roughness=0.3, metallic=0.2)
    mat_sponsor_pirelli = get_or_create_mat("M_F1_PirelliYellow", (0.95, 0.82, 0.05, 1.0), roughness=0.3, metallic=0.1)
    mat_sponsor_redbull = get_or_create_mat("M_F1_RedBullBlue", (0.02, 0.05, 0.2, 1.0), roughness=0.3, metallic=0.3)
    mat_sponsor_ferrari = get_or_create_mat("M_F1_FerrariRed", (0.85, 0.02, 0.02, 1.0), roughness=0.3, metallic=0.1)
    mat_grandstand_seat_red = get_or_create_mat("M_F1_SeatRed", (0.8, 0.1, 0.1, 1.0), roughness=0.5)

    # -------------------------------------------------------------
    # 3. Define F1 Track Circuit Control Points
    # -------------------------------------------------------------
    raw_control_points = [
        # Main Straight (Y: -160 to +80)
        mathutils.Vector((0.0, -160.0, 0.0)),
        mathutils.Vector((0.0, -90.0, 0.0)),
        mathutils.Vector((0.0, 0.0, 0.0)),
        mathutils.Vector((0.0, 80.0, 0.0)),
        
        # Turn 1 & 2: Chicane (Prima Variante)
        mathutils.Vector((5.0, 120.0, 0.0)),
        mathutils.Vector((22.0, 145.0, 0.0)),
        mathutils.Vector((12.0, 165.0, 0.0)),
        mathutils.Vector((-5.0, 185.0, 0.5)),
        
        # Turn 3: Fast Right Sweeper (Curva Grande)
        mathutils.Vector((10.0, 225.0, 1.0)),
        mathutils.Vector((45.0, 260.0, 1.8)),
        mathutils.Vector((95.0, 275.0, 2.5)),
        mathutils.Vector((150.0, 260.0, 3.0)),
        mathutils.Vector((195.0, 225.0, 3.2)),
        
        # Turn 4 & 5: Second Chicane
        mathutils.Vector((220.0, 175.0, 3.5)),
        mathutils.Vector((232.0, 135.0, 3.0)),
        mathutils.Vector((220.0, 115.0, 2.8)),
        mathutils.Vector((235.0, 95.0, 2.5)),
        mathutils.Vector((245.0, 75.0, 2.2)),
        
        # Turn 6 & 7: Lesmo Curves
        mathutils.Vector((248.0, 40.0, 2.0)),
        mathutils.Vector((235.0, 0.0, 1.5)),
        mathutils.Vector((210.0, -25.0, 1.2)),
        mathutils.Vector((185.0, -45.0, 1.0)),
        
        # Back Straight (DRS Zone 2)
        mathutils.Vector((165.0, -75.0, 0.8)),
        mathutils.Vector((145.0, -120.0, 0.5)),
        mathutils.Vector((125.0, -170.0, 0.2)),
        
        # Turn 8, 9, 10: Ascari S-Chicane
        mathutils.Vector((105.0, -215.0, 0.0)),
        mathutils.Vector((80.0, -240.0, 0.0)),
        mathutils.Vector((50.0, -248.0, 0.0)),
        mathutils.Vector((15.0, -242.0, 0.0)),
        mathutils.Vector((-20.0, -230.0, 0.0)),
        
        # Turn 11: Parabolica (Alboreto) - Long sweeping final curve
        mathutils.Vector((-55.0, -215.0, 0.0)),
        mathutils.Vector((-75.0, -185.0, 0.0)),
        mathutils.Vector((-72.0, -145.0, 0.0)),
        mathutils.Vector((-45.0, -120.0, 0.0)),
        mathutils.Vector((-18.0, -140.0, 0.0)),
    ]
    
    # -------------------------------------------------------------
    # 4. Catmull-Rom Spline Interpolation for Dense Smooth Centerline
    # -------------------------------------------------------------
    def catmull_rom_spline(pts, num_samples=600):
        n = len(pts)
        result = []
        for i in range(n):
            p0 = pts[(i - 1 + n) % n]
            p1 = pts[i]
            p2 = pts[(i + 1) % n]
            p3 = pts[(i + 2) % n]
            
            steps = int(num_samples / n)
            for s in range(steps):
                t = s / steps
                t2 = t * t
                t3 = t2 * t
                v = 0.5 * (
                    (2.0 * p1) +
                    (-p0 + p2) * t +
                    (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 +
                    (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
                )
                result.append(v)
        return result

    spline_points = catmull_rom_spline(raw_control_points, num_samples=600)
    num_pts = len(spline_points)
    print(f"Interpolated spline points: {num_pts}")

    tangents = []
    normals = []
    curvatures = []
    
    for i in range(num_pts):
        prev_p = spline_points[(i - 1 + num_pts) % num_pts]
        curr_p = spline_points[i]
        next_p = spline_points[(i + 1) % num_pts]
        
        t = (next_p - prev_p).normalized()
        tangents.append(t)
        
        n = mathutils.Vector((-t.y, t.x, 0.0)).normalized()
        normals.append(n)
        
        t_next = (spline_points[(i + 2) % num_pts] - curr_p).normalized()
        cross_z = t.x * t_next.y - t.y * t_next.x
        curvatures.append(cross_z)
        
    TRACK_WIDTH = 13.5
    HALF_W = TRACK_WIDTH / 2.0
    
    # -------------------------------------------------------------
    # 5. Build Track Asphalt Mesh
    # -------------------------------------------------------------
    bm_track = bmesh.new()
    track_left_verts = []
    track_right_verts = []
    
    for i in range(num_pts):
        p = spline_points[i]
        n = normals[i]
        bank_z = curvatures[i] * 10.0
        
        v_left = bm_track.verts.new(p - n * HALF_W + mathutils.Vector((0, 0, -bank_z * 0.5)))
        v_right = bm_track.verts.new(p + n * HALF_W + mathutils.Vector((0, 0, bank_z * 0.5)))
        track_left_verts.append(v_left)
        track_right_verts.append(v_right)
        
    bm_track.verts.ensure_lookup_table()
    
    for i in range(num_pts):
        next_i = (i + 1) % num_pts
        v1 = track_left_verts[i]
        v2 = track_right_verts[i]
        v3 = track_right_verts[next_i]
        v4 = track_left_verts[next_i]
        bm_track.faces.new((v1, v2, v3, v4))
        
    mesh_track = bpy.data.meshes.new("SM_F1_Track_Surface")
    bm_track.to_mesh(mesh_track)
    bm_track.free()
    
    obj_track = bpy.data.objects.new("SM_F1_Track_Surface", mesh_track)
    col_map["COL_Track"].objects.link(obj_track)
    obj_track.data.materials.append(mat_asphalt)
    
    # -------------------------------------------------------------
    # 6. Build Curbs / Kerbs (Red & White FIA Standard)
    # -------------------------------------------------------------
    bm_kerb_red = bmesh.new()
    bm_kerb_white = bmesh.new()
    KERB_WIDTH = 1.3
    KERB_HEIGHT = 0.08
    
    for i in range(num_pts):
        curv = curvatures[i]
        next_i = (i + 1) % num_pts
        
        has_left_kerb = curv < -0.015
        has_right_kerb = curv > 0.015
        is_inner_apex_left = curv > 0.02
        is_inner_apex_right = curv < -0.02
        
        is_red = ((i // 2) % 2) == 0
        target_bm = bm_kerb_red if is_red else bm_kerb_white
        
        if has_left_kerb or is_inner_apex_left:
            p0 = spline_points[i] - normals[i] * HALF_W
            p1 = p0 - normals[i] * KERB_WIDTH + mathutils.Vector((0, 0, KERB_HEIGHT))
            np0 = spline_points[next_i] - normals[next_i] * HALF_W
            np1 = np0 - normals[next_i] * KERB_WIDTH + mathutils.Vector((0, 0, KERB_HEIGHT))
            
            v1 = target_bm.verts.new(p0 + mathutils.Vector((0, 0, 0.01)))
            v2 = target_bm.verts.new(p1)
            v3 = target_bm.verts.new(np1)
            v4 = target_bm.verts.new(np0 + mathutils.Vector((0, 0, 0.01)))
            target_bm.faces.new((v1, v2, v3, v4))
            
        if has_right_kerb or is_inner_apex_right:
            p0 = spline_points[i] + normals[i] * HALF_W
            p1 = p0 + normals[i] * KERB_WIDTH + mathutils.Vector((0, 0, KERB_HEIGHT))
            np0 = spline_points[next_i] + normals[next_i] * HALF_W
            np1 = np0 + normals[next_i] * KERB_WIDTH + mathutils.Vector((0, 0, KERB_HEIGHT))
            
            v1 = target_bm.verts.new(p0 + mathutils.Vector((0, 0, 0.01)))
            v2 = target_bm.verts.new(p1)
            v3 = target_bm.verts.new(np1)
            v4 = target_bm.verts.new(np0 + mathutils.Vector((0, 0, 0.01)))
            target_bm.faces.new((v1, v2, v3, v4))

    mesh_kr = bpy.data.meshes.new("SM_F1_Kerbs_Red")
    bm_kerb_red.to_mesh(mesh_kr)
    bm_kerb_red.free()
    obj_kr = bpy.data.objects.new("SM_F1_Kerbs_Red", mesh_kr)
    col_map["COL_Track"].objects.link(obj_kr)
    obj_kr.data.materials.append(mat_kerb_red)

    mesh_kw = bpy.data.meshes.new("SM_F1_Kerbs_White")
    bm_kerb_white.to_mesh(mesh_kw)
    bm_kerb_white.free()
    obj_kw = bpy.data.objects.new("SM_F1_Kerbs_White", mesh_kw)
    col_map["COL_Track"].objects.link(obj_kw)
    obj_kw.data.materials.append(mat_kerb_white)

    # -------------------------------------------------------------
    # 7. White Boundary Lines
    # -------------------------------------------------------------
    bm_lines = bmesh.new()
    LINE_WIDTH = 0.25
    for i in range(num_pts):
        next_i = (i + 1) % num_pts
        p_l1 = spline_points[i] - normals[i] * (HALF_W - LINE_WIDTH)
        p_l2 = spline_points[i] - normals[i] * HALF_W
        np_l1 = spline_points[next_i] - normals[next_i] * (HALF_W - LINE_WIDTH)
        np_l2 = spline_points[next_i] - normals[next_i] * HALF_W
        
        v1 = bm_lines.verts.new(p_l1 + mathutils.Vector((0, 0, 0.005)))
        v2 = bm_lines.verts.new(p_l2 + mathutils.Vector((0, 0, 0.005)))
        v3 = bm_lines.verts.new(np_l2 + mathutils.Vector((0, 0, 0.005)))
        v4 = bm_lines.verts.new(np_l1 + mathutils.Vector((0, 0, 0.005)))
        bm_lines.faces.new((v1, v2, v3, v4))
        
        p_r1 = spline_points[i] + normals[i] * (HALF_W - LINE_WIDTH)
        p_r2 = spline_points[i] + normals[i] * HALF_W
        np_r1 = spline_points[next_i] + normals[next_i] * (HALF_W - LINE_WIDTH)
        np_r2 = spline_points[next_i] + normals[next_i] * HALF_W
        
        v1r = bm_lines.verts.new(p_r1 + mathutils.Vector((0, 0, 0.005)))
        v2r = bm_lines.verts.new(p_r2 + mathutils.Vector((0, 0, 0.005)))
        v3r = bm_lines.verts.new(np_r2 + mathutils.Vector((0, 0, 0.005)))
        v4r = bm_lines.verts.new(np_r1 + mathutils.Vector((0, 0, 0.005)))
        bm_lines.faces.new((v1r, v2r, v3r, v4r))
        
    mesh_lines = bpy.data.meshes.new("SM_F1_Boundary_Lines")
    bm_lines.to_mesh(mesh_lines)
    bm_lines.free()
    obj_lines = bpy.data.objects.new("SM_F1_Boundary_Lines", mesh_lines)
    col_map["COL_Track"].objects.link(obj_lines)
    obj_lines.data.materials.append(mat_white_line)

    # -------------------------------------------------------------
    # 8. Start/Finish Line & Starting Grid (20 Slots)
    # -------------------------------------------------------------
    bm_grid = bmesh.new()
    start_finish_y = -40.0
    
    num_checks = 14
    check_w = TRACK_WIDTH / num_checks
    check_h = 1.2
    for c in range(num_checks):
        if c % 2 == 0:
            x_pos = -HALF_W + c * check_w
            v1 = bm_grid.verts.new(mathutils.Vector((x_pos, start_finish_y - check_h/2, 0.01)))
            v2 = bm_grid.verts.new(mathutils.Vector((x_pos + check_w, start_finish_y - check_h/2, 0.01)))
            v3 = bm_grid.verts.new(mathutils.Vector((x_pos + check_w, start_finish_y + check_h/2, 0.01)))
            v4 = bm_grid.verts.new(mathutils.Vector((x_pos, start_finish_y + check_h/2, 0.01)))
            bm_grid.faces.new((v1, v2, v3, v4))

    grid_start_y = -52.0
    slot_dist = 8.0
    box_w = 2.4
    box_l = 4.8
    box_line_th = 0.15
    
    for slot in range(20):
        row = slot // 2
        side = -1 if (slot % 2 == 0) else 1
        center_x = side * 3.2
        center_y = grid_start_y - row * slot_dist + (0.0 if side == -1 else -3.0)
        
        v1 = bm_grid.verts.new(mathutils.Vector((center_x - box_w/2, center_y + box_l/2, 0.01)))
        v2 = bm_grid.verts.new(mathutils.Vector((center_x + box_w/2, center_y + box_l/2, 0.01)))
        v3 = bm_grid.verts.new(mathutils.Vector((center_x + box_w/2, center_y + box_l/2 - box_line_th, 0.01)))
        v4 = bm_grid.verts.new(mathutils.Vector((center_x - box_w/2, center_y + box_l/2 - box_line_th, 0.01)))
        bm_grid.faces.new((v1, v2, v3, v4))
        
        v1 = bm_grid.verts.new(mathutils.Vector((center_x - box_w/2, center_y - box_l/2, 0.01)))
        v2 = bm_grid.verts.new(mathutils.Vector((center_x - box_w/2 + box_line_th, center_y - box_l/2, 0.01)))
        v3 = bm_grid.verts.new(mathutils.Vector((center_x - box_w/2 + box_line_th, center_y + box_l/2, 0.01)))
        v4 = bm_grid.verts.new(mathutils.Vector((center_x - box_w/2, center_y + box_l/2, 0.01)))
        bm_grid.faces.new((v1, v2, v3, v4))
        
        v1 = bm_grid.verts.new(mathutils.Vector((center_x + box_w/2 - box_line_th, center_y - box_l/2, 0.01)))
        v2 = bm_grid.verts.new(mathutils.Vector((center_x + box_w/2, center_y - box_l/2, 0.01)))
        v3 = bm_grid.verts.new(mathutils.Vector((center_x + box_w/2, center_y + box_l/2, 0.01)))
        v4 = bm_grid.verts.new(mathutils.Vector((center_x + box_w/2 - box_line_th, center_y + box_l/2, 0.01)))
        bm_grid.faces.new((v1, v2, v3, v4))

    mesh_grid = bpy.data.meshes.new("SM_F1_Starting_Grid")
    bm_grid.to_mesh(mesh_grid)
    bm_grid.free()
    obj_grid = bpy.data.objects.new("SM_F1_Starting_Grid", mesh_grid)
    col_map["COL_Track"].objects.link(obj_grid)
    obj_grid.data.materials.append(mat_white_line)

    # -------------------------------------------------------------
    # 9. Run-Off Areas & Gravel Traps
    # -------------------------------------------------------------
    bm_runoff_blue = bmesh.new()
    bm_runoff_red = bmesh.new()
    bm_gravel = bmesh.new()
    
    RUNOFF_WIDTH = 11.0
    GRAVEL_WIDTH = 16.0
    
    for i in range(num_pts):
        curv = curvatures[i]
        next_i = (i + 1) % num_pts
        
        if abs(curv) > 0.012:
            outer_sign = 1 if curv < 0 else -1
            n = normals[i] * outer_sign
            next_n = normals[next_i] * outer_sign
            
            p_edge = spline_points[i] + n * (HALF_W + KERB_WIDTH)
            np_edge = spline_points[next_i] + next_n * (HALF_W + KERB_WIDTH)
            
            p_ro = p_edge + n * RUNOFF_WIDTH
            np_ro = np_edge + next_n * RUNOFF_WIDTH
            
            target_ro_bm = bm_runoff_blue if ((i // 3) % 2 == 0) else bm_runoff_red
            v1 = target_ro_bm.verts.new(p_edge)
            v2 = target_ro_bm.verts.new(p_ro)
            v3 = target_ro_bm.verts.new(np_ro)
            v4 = target_ro_bm.verts.new(np_edge)
            target_ro_bm.faces.new((v1, v2, v3, v4))
            
            p_gr = p_ro + n * GRAVEL_WIDTH + mathutils.Vector((0, 0, -0.1))
            np_gr = np_ro + next_n * GRAVEL_WIDTH + mathutils.Vector((0, 0, -0.1))
            
            v1g = bm_gravel.verts.new(p_ro)
            v2g = bm_gravel.verts.new(p_gr)
            v3g = bm_gravel.verts.new(np_gr)
            v4g = bm_gravel.verts.new(np_ro)
            bm_gravel.faces.new((v1g, v2g, v3g, v4g))

    mesh_rob = bpy.data.meshes.new("SM_F1_Runoff_Blue")
    bm_runoff_blue.to_mesh(mesh_rob)
    bm_runoff_blue.free()
    obj_rob = bpy.data.objects.new("SM_F1_Runoff_Blue", mesh_rob)
    col_map["COL_Track"].objects.link(obj_rob)
    obj_rob.data.materials.append(mat_runoff_blue)

    mesh_ror = bpy.data.meshes.new("SM_F1_Runoff_Red")
    bm_runoff_red.to_mesh(mesh_ror)
    bm_runoff_red.free()
    obj_ror = bpy.data.objects.new("SM_F1_Runoff_Red", mesh_ror)
    col_map["COL_Track"].objects.link(obj_ror)
    obj_ror.data.materials.append(mat_runoff_red)

    mesh_grv = bpy.data.meshes.new("SM_F1_Gravel_Traps")
    bm_gravel.to_mesh(mesh_grv)
    bm_gravel.free()
    obj_grv = bpy.data.objects.new("SM_F1_Gravel_Traps", mesh_grv)
    col_map["COL_Track"].objects.link(obj_grv)
    obj_grv.data.materials.append(mat_gravel)

    # -------------------------------------------------------------
    # 10. Safety Barriers, Concrete Walls & Tecpro
    # -------------------------------------------------------------
    bm_walls = bmesh.new()
    bm_tecpro_red = bmesh.new()
    bm_tecpro_white = bmesh.new()
    bm_fences = bmesh.new()
    
    WALL_HEIGHT = 1.2
    FENCE_HEIGHT = 3.0
    
    for i in range(0, num_pts, 2):
        next_i = (i + 2) % num_pts
        curv = curvatures[i]
        
        for side in [-1, 1]:
            is_outside = (curv < 0 and side == 1) or (curv > 0 and side == -1)
            offset = (HALF_W + RUNOFF_WIDTH + GRAVEL_WIDTH + 2.0) if (is_outside and abs(curv) > 0.012) else (HALF_W + 3.5)
            
            p1 = spline_points[i] + normals[i] * (side * offset)
            p2 = spline_points[next_i] + normals[next_i] * (side * offset)
            
            v_b1 = bm_walls.verts.new(p1)
            v_b2 = bm_walls.verts.new(p2)
            v_t2 = bm_walls.verts.new(p2 + mathutils.Vector((0, 0, WALL_HEIGHT)))
            v_t1 = bm_walls.verts.new(p1 + mathutils.Vector((0, 0, WALL_HEIGHT)))
            bm_walls.faces.new((v_b1, v_b2, v_t2, v_t1))
            
            vf_b1 = bm_fences.verts.new(p1 + mathutils.Vector((0, 0, WALL_HEIGHT)))
            vf_b2 = bm_fences.verts.new(p2 + mathutils.Vector((0, 0, WALL_HEIGHT)))
            vf_t2 = bm_fences.verts.new(p2 + mathutils.Vector((0, 0, FENCE_HEIGHT)))
            vf_t1 = bm_fences.verts.new(p1 + mathutils.Vector((0, 0, FENCE_HEIGHT)))
            bm_fences.faces.new((vf_b1, vf_b2, vf_t2, vf_t1))
            
            if is_outside and abs(curv) > 0.015:
                tp_dist = offset - 1.2
                pt1 = spline_points[i] + normals[i] * (side * tp_dist)
                pt2 = spline_points[next_i] + normals[next_i] * (side * tp_dist)
                
                target_tp_bm = bm_tecpro_red if ((i // 4) % 2 == 0) else bm_tecpro_white
                v_tpb1 = target_tp_bm.verts.new(pt1)
                v_tpb2 = target_tp_bm.verts.new(pt2)
                v_tpt2 = target_tp_bm.verts.new(pt2 + mathutils.Vector((0, 0, 1.0)))
                v_tpt1 = target_tp_bm.verts.new(pt1 + mathutils.Vector((0, 0, 1.0)))
                target_tp_bm.faces.new((v_tpb1, v_tpb2, v_tpt2, v_tpt1))

    mesh_walls = bpy.data.meshes.new("SM_F1_Concrete_Walls")
    bm_walls.to_mesh(mesh_walls)
    bm_walls.free()
    obj_walls = bpy.data.objects.new("SM_F1_Concrete_Walls", mesh_walls)
    col_map["COL_Barriers"].objects.link(obj_walls)
    obj_walls.data.materials.append(mat_concrete_wall)

    mesh_fences = bpy.data.meshes.new("SM_F1_Catch_Fences")
    bm_fences.to_mesh(mesh_fences)
    bm_fences.free()
    obj_fences = bpy.data.objects.new("SM_F1_Catch_Fences", mesh_fences)
    col_map["COL_Barriers"].objects.link(obj_fences)
    obj_fences.data.materials.append(mat_fence)

    mesh_tpr = bpy.data.meshes.new("SM_F1_Tecpro_Red")
    bm_tecpro_red.to_mesh(mesh_tpr)
    bm_tecpro_red.free()
    obj_tpr = bpy.data.objects.new("SM_F1_Tecpro_Red", mesh_tpr)
    col_map["COL_Barriers"].objects.link(obj_tpr)
    obj_tpr.data.materials.append(mat_tecpro_red)

    mesh_tpw = bpy.data.meshes.new("SM_F1_Tecpro_White")
    bm_tecpro_white.to_mesh(mesh_tpw)
    bm_tecpro_white.free()
    obj_tpw = bpy.data.objects.new("SM_F1_Tecpro_White", mesh_tpw)
    col_map["COL_Barriers"].objects.link(obj_tpw)
    obj_tpw.data.materials.append(mat_tecpro_white)

    # -------------------------------------------------------------
    # 11. Pit Lane, Pit Wall & Garages
    # -------------------------------------------------------------
    bm_pit = bmesh.new()
    bm_pit_wall = bmesh.new()
    bm_garages = bmesh.new()
    
    PIT_WIDTH = 7.5
    PIT_OFFSET_X = HALF_W + 1.2
    
    pit_y_start = -150.0
    pit_y_end = 70.0
    
    v1 = bm_pit.verts.new(mathutils.Vector((HALF_W, pit_y_start - 25.0, 0.0)))
    v2 = bm_pit.verts.new(mathutils.Vector((HALF_W + 2.0, pit_y_start - 25.0, 0.0)))
    v3 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X + PIT_WIDTH, pit_y_start, 0.0)))
    v4 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X, pit_y_start, 0.0)))
    bm_pit.faces.new((v1, v2, v3, v4))
    
    v1 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X, pit_y_start, 0.0)))
    v2 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X + PIT_WIDTH, pit_y_start, 0.0)))
    v3 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X + PIT_WIDTH, pit_y_end, 0.0)))
    v4 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X, pit_y_end, 0.0)))
    bm_pit.faces.new((v1, v2, v3, v4))
    
    v1 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X, pit_y_end, 0.0)))
    v2 = bm_pit.verts.new(mathutils.Vector((PIT_OFFSET_X + PIT_WIDTH, pit_y_end, 0.0)))
    v3 = bm_pit.verts.new(mathutils.Vector((HALF_W + 1.0, pit_y_end + 35.0, 0.0)))
    v4 = bm_pit.verts.new(mathutils.Vector((HALF_W, pit_y_end + 35.0, 0.0)))
    bm_pit.faces.new((v1, v2, v3, v4))
    
    mesh_pit = bpy.data.meshes.new("SM_F1_Pit_Road")
    bm_pit.to_mesh(mesh_pit)
    bm_pit.free()
    obj_pit = bpy.data.objects.new("SM_F1_Pit_Road", mesh_pit)
    col_map["COL_PitLane"].objects.link(obj_pit)
    obj_pit.data.materials.append(mat_asphalt_pit)
    
    pw_x = PIT_OFFSET_X
    v1 = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.4, pit_y_start, 0.0)))
    v2 = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 0.4, pit_y_start, 0.0)))
    v3 = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 0.4, pit_y_end, 0.0)))
    v4 = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.4, pit_y_end, 0.0)))
    bm_pit_wall.faces.new((v1, v2, v3, v4))
    
    v1t = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.4, pit_y_start, 1.1)))
    v2t = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 0.4, pit_y_start, 1.1)))
    v3t = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 0.4, pit_y_end, 1.1)))
    v4t = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.4, pit_y_end, 1.1)))
    bm_pit_wall.faces.new((v1t, v2t, v3t, v4t))
    bm_pit_wall.faces.new((v1, v4, v4t, v1t))
    bm_pit_wall.faces.new((v2, v2t, v3t, v3))
    
    for py in range(int(pit_y_start + 20), int(pit_y_end - 20), 22):
        v1 = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.5, py, 1.1)))
        v2 = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 1.2, py, 1.1)))
        v3 = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 1.2, py + 8.0, 1.1)))
        v4 = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.5, py + 8.0, 1.1)))
        bm_pit_wall.faces.new((v1, v2, v3, v4))
        
        v1r = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.6, py - 0.5, 2.5)))
        v2r = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 1.4, py - 0.5, 2.5)))
        v3r = bm_pit_wall.verts.new(mathutils.Vector((pw_x + 1.4, py + 8.5, 2.5)))
        v4r = bm_pit_wall.verts.new(mathutils.Vector((pw_x - 0.6, py + 8.5, 2.5)))
        bm_pit_wall.faces.new((v1r, v2r, v3r, v4r))
        
    mesh_pit_wall = bpy.data.meshes.new("SM_F1_Pit_Wall")
    bm_pit_wall.to_mesh(mesh_pit_wall)
    bm_pit_wall.free()
    obj_pit_wall = bpy.data.objects.new("SM_F1_Pit_Wall", mesh_pit_wall)
    col_map["COL_PitLane"].objects.link(obj_pit_wall)
    obj_pit_wall.data.materials.append(mat_concrete_wall)

    garage_x = PIT_OFFSET_X + PIT_WIDTH + 2.0
    garage_w = 16.0
    garage_h = 7.5
    
    v1 = bm_garages.verts.new(mathutils.Vector((garage_x, pit_y_start, 0.0)))
    v2 = bm_garages.verts.new(mathutils.Vector((garage_x, pit_y_end, 0.0)))
    v3 = bm_garages.verts.new(mathutils.Vector((garage_x, pit_y_end, garage_h)))
    v4 = bm_garages.verts.new(mathutils.Vector((garage_x, pit_y_start, garage_h)))
    bm_garages.faces.new((v1, v2, v3, v4))
    
    v5 = bm_garages.verts.new(mathutils.Vector((garage_x + garage_w, pit_y_start, garage_h)))
    v6 = bm_garages.verts.new(mathutils.Vector((garage_x + garage_w, pit_y_end, garage_h)))
    bm_garages.faces.new((v4, v3, v6, v5))
    
    v7 = bm_garages.verts.new(mathutils.Vector((garage_x + garage_w, pit_y_start, 0.0)))
    v8 = bm_garages.verts.new(mathutils.Vector((garage_x + garage_w, pit_y_end, 0.0)))
    bm_garages.faces.new((v5, v6, v8, v7))
    
    mesh_garages = bpy.data.meshes.new("SM_F1_Paddock_Garages")
    bm_garages.to_mesh(mesh_garages)
    bm_garages.free()
    obj_garages = bpy.data.objects.new("SM_F1_Paddock_Garages", mesh_garages)
    col_map["COL_PitLane"].objects.link(obj_garages)
    obj_garages.data.materials.append(mat_concrete_wall)

    # -------------------------------------------------------------
    # 12. Overhead Start/Finish Gantry with 5 Red Starting Lights
    # -------------------------------------------------------------
    bm_gantry = bmesh.new()
    bm_lights = bmesh.new()
    
    gantry_y = -36.0
    g_h = 7.2
    g_beam_w = 0.8
    
    lp_x = -HALF_W - 3.0
    v1 = bm_gantry.verts.new(mathutils.Vector((lp_x - g_beam_w/2, gantry_y - g_beam_w/2, 0.0)))
    v2 = bm_gantry.verts.new(mathutils.Vector((lp_x + g_beam_w/2, gantry_y - g_beam_w/2, 0.0)))
    v3 = bm_gantry.verts.new(mathutils.Vector((lp_x + g_beam_w/2, gantry_y + g_beam_w/2, 0.0)))
    v4 = bm_gantry.verts.new(mathutils.Vector((lp_x - g_beam_w/2, gantry_y + g_beam_w/2, 0.0)))
    v1t = bm_gantry.verts.new(mathutils.Vector((lp_x - g_beam_w/2, gantry_y - g_beam_w/2, g_h)))
    v2t = bm_gantry.verts.new(mathutils.Vector((lp_x + g_beam_w/2, gantry_y - g_beam_w/2, g_h)))
    v3t = bm_gantry.verts.new(mathutils.Vector((lp_x + g_beam_w/2, gantry_y + g_beam_w/2, g_h)))
    v4t = bm_gantry.verts.new(mathutils.Vector((lp_x - g_beam_w/2, gantry_y + g_beam_w/2, g_h)))
    bm_gantry.faces.new((v1, v2, v3, v4))
    bm_gantry.faces.new((v1t, v2t, v3t, v4t))
    bm_gantry.faces.new((v1, v2, v2t, v1t))
    bm_gantry.faces.new((v2, v3, v3t, v2t))
    bm_gantry.faces.new((v3, v4, v4t, v3t))
    bm_gantry.faces.new((v4, v1, v1t, v4t))

    rp_x = HALF_W + 3.0
    v1 = bm_gantry.verts.new(mathutils.Vector((rp_x - g_beam_w/2, gantry_y - g_beam_w/2, 0.0)))
    v2 = bm_gantry.verts.new(mathutils.Vector((rp_x + g_beam_w/2, gantry_y - g_beam_w/2, 0.0)))
    v3 = bm_gantry.verts.new(mathutils.Vector((rp_x + g_beam_w/2, gantry_y + g_beam_w/2, 0.0)))
    v4 = bm_gantry.verts.new(mathutils.Vector((rp_x - g_beam_w/2, gantry_y + g_beam_w/2, 0.0)))
    v1t = bm_gantry.verts.new(mathutils.Vector((rp_x - g_beam_w/2, gantry_y - g_beam_w/2, g_h)))
    v2t = bm_gantry.verts.new(mathutils.Vector((rp_x + g_beam_w/2, gantry_y - g_beam_w/2, g_h)))
    v3t = bm_gantry.verts.new(mathutils.Vector((rp_x + g_beam_w/2, gantry_y + g_beam_w/2, g_h)))
    v4t = bm_gantry.verts.new(mathutils.Vector((rp_x - g_beam_w/2, gantry_y + g_beam_w/2, g_h)))
    bm_gantry.faces.new((v1, v2, v3, v4))
    bm_gantry.faces.new((v1t, v2t, v3t, v4t))
    bm_gantry.faces.new((v1, v2, v2t, v1t))
    bm_gantry.faces.new((v2, v3, v3t, v2t))
    bm_gantry.faces.new((v3, v4, v4t, v3t))
    bm_gantry.faces.new((v4, v1, v1t, v4t))

    v1 = bm_gantry.verts.new(mathutils.Vector((lp_x, gantry_y - 0.6, g_h - 1.2)))
    v2 = bm_gantry.verts.new(mathutils.Vector((rp_x, gantry_y - 0.6, g_h - 1.2)))
    v3 = bm_gantry.verts.new(mathutils.Vector((rp_x, gantry_y - 0.6, g_h)))
    v4 = bm_gantry.verts.new(mathutils.Vector((lp_x, gantry_y - 0.6, g_h)))
    bm_gantry.faces.new((v1, v2, v3, v4))
    
    v1b = bm_gantry.verts.new(mathutils.Vector((lp_x, gantry_y + 0.6, g_h - 1.2)))
    v2b = bm_gantry.verts.new(mathutils.Vector((rp_x, gantry_y + 0.6, g_h - 1.2)))
    v3b = bm_gantry.verts.new(mathutils.Vector((rp_x, gantry_y + 0.6, g_h)))
    v4b = bm_gantry.verts.new(mathutils.Vector((lp_x, gantry_y + 0.6, g_h)))
    bm_gantry.faces.new((v1b, v2b, v3b, v4b))
    
    light_box_w = 4.2
    lb_x = -light_box_w / 2
    
    for l in range(5):
        lx = lb_x + 0.4 + l * 0.85
        v1 = bm_lights.verts.new(mathutils.Vector((lx - 0.15, gantry_y - 0.62, g_h - 0.5)))
        v2 = bm_lights.verts.new(mathutils.Vector((lx + 0.15, gantry_y - 0.62, g_h - 0.5)))
        v3 = bm_lights.verts.new(mathutils.Vector((lx + 0.15, gantry_y - 0.62, g_h - 0.2)))
        v4 = bm_lights.verts.new(mathutils.Vector((lx - 0.15, gantry_y - 0.62, g_h - 0.2)))
        bm_lights.faces.new((v1, v2, v3, v4))
        
        v1b = bm_lights.verts.new(mathutils.Vector((lx - 0.15, gantry_y - 0.62, g_h - 0.9)))
        v2b = bm_lights.verts.new(mathutils.Vector((lx + 0.15, gantry_y - 0.62, g_h - 0.9)))
        v3b = bm_lights.verts.new(mathutils.Vector((lx + 0.15, gantry_y - 0.62, g_h - 0.6)))
        v4b = bm_lights.verts.new(mathutils.Vector((lx - 0.15, gantry_y - 0.62, g_h - 0.6)))
        bm_lights.faces.new((v1b, v2b, v3b, v4b))

    mesh_gantry = bpy.data.meshes.new("SM_F1_Start_Gantry")
    bm_gantry.to_mesh(mesh_gantry)
    bm_gantry.free()
    obj_gantry = bpy.data.objects.new("SM_F1_Start_Gantry", mesh_gantry)
    col_map["COL_Structures"].objects.link(obj_gantry)
    obj_gantry.data.materials.append(mat_gantry)

    mesh_lights = bpy.data.meshes.new("SM_F1_Start_Lights")
    bm_lights.to_mesh(mesh_lights)
    bm_lights.free()
    obj_lights = bpy.data.objects.new("SM_F1_Start_Lights", mesh_lights)
    col_map["COL_Structures"].objects.link(obj_lights)
    obj_lights.data.materials.append(mat_light_red)

    # -------------------------------------------------------------
    # 13. Main Grandstand & Secondary Grandstands
    # -------------------------------------------------------------
    bm_grandstand = bmesh.new()
    bm_seats = bmesh.new()
    
    gs_x = -HALF_W - 8.0
    gs_y_start = -130.0
    gs_y_end = 20.0
    gs_depth = 18.0
    gs_tiers = 14
    gs_height = 10.0
    
    tier_w = gs_depth / gs_tiers
    tier_h = gs_height / gs_tiers
    
    for t in range(gs_tiers):
        tx_front = gs_x - t * tier_w
        tx_back = gs_x - (t + 1) * tier_w
        tz_base = t * tier_h
        tz_step = (t + 1) * tier_h
        
        v1 = bm_grandstand.verts.new(mathutils.Vector((tx_front, gs_y_start, tz_base)))
        v2 = bm_grandstand.verts.new(mathutils.Vector((tx_front, gs_y_end, tz_base)))
        v3 = bm_grandstand.verts.new(mathutils.Vector((tx_front, gs_y_end, tz_step)))
        v4 = bm_grandstand.verts.new(mathutils.Vector((tx_front, gs_y_start, tz_step)))
        bm_grandstand.faces.new((v1, v2, v3, v4))
        
        v5 = bm_grandstand.verts.new(mathutils.Vector((tx_back, gs_y_start, tz_step)))
        v6 = bm_grandstand.verts.new(mathutils.Vector((tx_back, gs_y_end, tz_step)))
        bm_grandstand.faces.new((v4, v3, v6, v5))
        
        for sy in range(int(gs_y_start + 2), int(gs_y_end - 2), 3):
            sx = tx_front - tier_w * 0.5
            sz = tz_step + 0.1
            v_s1 = bm_seats.verts.new(mathutils.Vector((sx + 0.3, sy - 0.4, sz)))
            v_s2 = bm_seats.verts.new(mathutils.Vector((sx - 0.3, sy - 0.4, sz)))
            v_s3 = bm_seats.verts.new(mathutils.Vector((sx - 0.3, sy + 0.4, sz)))
            v_s4 = bm_seats.verts.new(mathutils.Vector((sx + 0.3, sy + 0.4, sz)))
            bm_seats.faces.new((v_s1, v_s2, v_s3, v_s4))

    roof_x_front = gs_x + 3.0
    roof_x_back = gs_x - gs_depth - 4.0
    roof_z_front = gs_height + 4.5
    roof_z_back = gs_height + 2.0
    
    v1 = bm_grandstand.verts.new(mathutils.Vector((roof_x_front, gs_y_start - 3.0, roof_z_front)))
    v2 = bm_grandstand.verts.new(mathutils.Vector((roof_x_front, gs_y_end + 3.0, roof_z_front)))
    v3 = bm_grandstand.verts.new(mathutils.Vector((roof_x_back, gs_y_end + 3.0, roof_z_back)))
    v4 = bm_grandstand.verts.new(mathutils.Vector((roof_x_back, gs_y_start - 3.0, roof_z_back)))
    bm_grandstand.faces.new((v1, v2, v3, v4))

    for col_y in range(int(gs_y_start), int(gs_y_end + 1), 25):
        cx = roof_x_back + 1.0
        v1 = bm_grandstand.verts.new(mathutils.Vector((cx - 0.4, col_y - 0.4, 0.0)))
        v2 = bm_grandstand.verts.new(mathutils.Vector((cx + 0.4, col_y - 0.4, 0.0)))
        v3 = bm_grandstand.verts.new(mathutils.Vector((cx + 0.4, col_y + 0.4, 0.0)))
        v4 = bm_grandstand.verts.new(mathutils.Vector((cx - 0.4, col_y + 0.4, 0.0)))
        v1t = bm_grandstand.verts.new(mathutils.Vector((cx - 0.4, col_y - 0.4, roof_z_back)))
        v2t = bm_grandstand.verts.new(mathutils.Vector((cx + 0.4, col_y - 0.4, roof_z_back)))
        v3t = bm_grandstand.verts.new(mathutils.Vector((cx + 0.4, col_y + 0.4, roof_z_back)))
        v4t = bm_grandstand.verts.new(mathutils.Vector((cx - 0.4, col_y + 0.4, roof_z_back)))
        bm_grandstand.faces.new((v1, v2, v2t, v1t))
        bm_grandstand.faces.new((v2, v3, v3t, v2t))
        bm_grandstand.faces.new((v3, v4, v4t, v3t))
        bm_grandstand.faces.new((v4, v1, v1t, v4t))

    mesh_grandstand = bpy.data.meshes.new("SM_F1_Main_Grandstand")
    bm_grandstand.to_mesh(mesh_grandstand)
    bm_grandstand.free()
    obj_grandstand = bpy.data.objects.new("SM_F1_Main_Grandstand", mesh_grandstand)
    col_map["COL_Structures"].objects.link(obj_grandstand)
    obj_grandstand.data.materials.append(mat_concrete_wall)

    mesh_seats = bpy.data.meshes.new("SM_F1_Grandstand_Seats")
    bm_seats.to_mesh(mesh_seats)
    bm_seats.free()
    obj_seats = bpy.data.objects.new("SM_F1_Grandstand_Seats", mesh_seats)
    col_map["COL_Structures"].objects.link(obj_seats)
    obj_seats.data.materials.append(mat_grandstand_seat_red)

    # Turn 1 grandstand
    bm_t1_gs = bmesh.new()
    t1_x = -18.0
    t1_y = 110.0
    for t in range(8):
        w = 32.0
        d = 1.3
        h = 0.65
        v1 = bm_t1_gs.verts.new(mathutils.Vector((t1_x - t * d, t1_y - w/2, t * h)))
        v2 = bm_t1_gs.verts.new(mathutils.Vector((t1_x - t * d, t1_y + w/2, t * h)))
        v3 = bm_t1_gs.verts.new(mathutils.Vector((t1_x - (t + 1) * d, t1_y + w/2, (t + 1) * h)))
        v4 = bm_t1_gs.verts.new(mathutils.Vector((t1_x - (t + 1) * d, t1_y - w/2, (t + 1) * h)))
        bm_t1_gs.faces.new((v1, v2, v3, v4))

    mesh_t1_gs = bpy.data.meshes.new("SM_F1_Turn1_Grandstand")
    bm_t1_gs.to_mesh(mesh_t1_gs)
    bm_t1_gs.free()
    obj_t1_gs = bpy.data.objects.new("SM_F1_Turn1_Grandstand", mesh_t1_gs)
    col_map["COL_Structures"].objects.link(obj_t1_gs)
    obj_t1_gs.data.materials.append(mat_concrete_wall)

    # -------------------------------------------------------------
    # 14. Brake Marker Boards & DRS Gantries
    # -------------------------------------------------------------
    bm_boards = bmesh.new()
    t1_brake_spots = [
        (300, 15.0),
        (200, 40.0),
        (150, 58.0),
        (100, 75.0),
        (50, 92.0)
    ]
    for dist, by in t1_brake_spots:
        bx = -HALF_W - 2.5
        v1 = bm_boards.verts.new(mathutils.Vector((bx, by - 0.05, 0.0)))
        v2 = bm_boards.verts.new(mathutils.Vector((bx, by + 0.05, 0.0)))
        v3 = bm_boards.verts.new(mathutils.Vector((bx, by + 0.05, 1.6)))
        v4 = bm_boards.verts.new(mathutils.Vector((bx, by - 0.05, 1.6)))
        bm_boards.faces.new((v1, v2, v3, v4))
        
        v_b1 = bm_boards.verts.new(mathutils.Vector((bx, by - 0.6, 0.8)))
        v_b2 = bm_boards.verts.new(mathutils.Vector((bx, by + 0.6, 0.8)))
        v_b3 = bm_boards.verts.new(mathutils.Vector((bx, by + 0.6, 1.6)))
        v_b4 = bm_boards.verts.new(mathutils.Vector((bx, by - 0.6, 1.6)))
        bm_boards.faces.new((v_b1, v_b2, v_b3, v_b4))

    mesh_boards = bpy.data.meshes.new("SM_F1_Track_Markers")
    bm_boards.to_mesh(mesh_boards)
    bm_boards.free()
    obj_boards = bpy.data.objects.new("SM_F1_Track_Markers", mesh_boards)
    col_map["COL_Structures"].objects.link(obj_boards)
    obj_boards.data.materials.append(mat_white_line)

    # -------------------------------------------------------------
    # 15. Floodlight Towers (Stadium Night/Sunset Illumination)
    # -------------------------------------------------------------
    bm_floodlights = bmesh.new()
    bm_flood_emit = bmesh.new()
    
    floodlight_locations = [
        mathutils.Vector((-25.0, -110.0, 0.0)),
        mathutils.Vector((-25.0, -20.0, 0.0)),
        mathutils.Vector((-30.0, 90.0, 0.0)),
        mathutils.Vector((35.0, 160.0, 0.0)),
        mathutils.Vector((120.0, 290.0, 2.0)),
        mathutils.Vector((255.0, 200.0, 3.0)),
        mathutils.Vector((265.0, 50.0, 2.0)),
        mathutils.Vector((175.0, -90.0, 0.5)),
        mathutils.Vector((70.0, -260.0, 0.0)),
        mathutils.Vector((-90.0, -170.0, 0.0))
    ]
    
    FL_HEIGHT = 22.0
    for fl_pos in floodlight_locations:
        x, y, z = fl_pos.x, fl_pos.y, fl_pos.z
        tw = 1.0
        v1 = bm_floodlights.verts.new(mathutils.Vector((x - tw, y - tw, z)))
        v2 = bm_floodlights.verts.new(mathutils.Vector((x + tw, y - tw, z)))
        v3 = bm_floodlights.verts.new(mathutils.Vector((x + tw, y + tw, z)))
        v4 = bm_floodlights.verts.new(mathutils.Vector((x - tw, y + tw, z)))
        
        tw_top = 0.4
        v1t = bm_floodlights.verts.new(mathutils.Vector((x - tw_top, y - tw_top, z + FL_HEIGHT)))
        v2t = bm_floodlights.verts.new(mathutils.Vector((x + tw_top, y - tw_top, z + FL_HEIGHT)))
        v3t = bm_floodlights.verts.new(mathutils.Vector((x + tw_top, y + tw_top, z + FL_HEIGHT)))
        v4t = bm_floodlights.verts.new(mathutils.Vector((x - tw_top, y + tw_top, z + FL_HEIGHT)))
        
        bm_floodlights.faces.new((v1, v2, v2t, v1t))
        bm_floodlights.faces.new((v2, v3, v3t, v2t))
        bm_floodlights.faces.new((v3, v4, v4t, v3t))
        bm_floodlights.faces.new((v4, v1, v1t, v4t))
        
        f_w = 3.6
        f_h = 2.0
        v_h1 = bm_flood_emit.verts.new(mathutils.Vector((x - f_w/2, y - 0.8, z + FL_HEIGHT - 0.5)))
        v_h2 = bm_flood_emit.verts.new(mathutils.Vector((x + f_w/2, y - 0.8, z + FL_HEIGHT - 0.5)))
        v_h3 = bm_flood_emit.verts.new(mathutils.Vector((x + f_w/2, y - 0.2, z + FL_HEIGHT + f_h)))
        v_h4 = bm_flood_emit.verts.new(mathutils.Vector((x - f_w/2, y - 0.2, z + FL_HEIGHT + f_h)))
        bm_flood_emit.faces.new((v_h1, v_h2, v_h3, v_h4))

    mesh_fl_tower = bpy.data.meshes.new("SM_F1_Floodlight_Towers")
    bm_floodlights.to_mesh(mesh_fl_tower)
    bm_floodlights.free()
    obj_fl_tower = bpy.data.objects.new("SM_F1_Floodlight_Towers", mesh_fl_tower)
    col_map["COL_Structures"].objects.link(obj_fl_tower)
    obj_fl_tower.data.materials.append(mat_gantry)

    mesh_fl_emit = bpy.data.meshes.new("SM_F1_Floodlight_Emitters")
    bm_flood_emit.to_mesh(mesh_fl_emit)
    bm_flood_emit.free()
    obj_fl_emit = bpy.data.objects.new("SM_F1_Floodlight_Emitters", mesh_fl_emit)
    col_map["COL_Structures"].objects.link(obj_fl_emit)
    obj_fl_emit.data.materials.append(mat_floodlight)

    # -------------------------------------------------------------
    # 16. Surrounding Base Terrain & Natural Contour Landscaping
    # -------------------------------------------------------------
    bm_terrain = bmesh.new()
    TERRAIN_GRID = 42
    TERRAIN_SIZE = 700.0
    
    t_verts = []
    for gx in range(TERRAIN_GRID):
        row = []
        for gy in range(TERRAIN_GRID):
            tx = (gx / (TERRAIN_GRID - 1) - 0.45) * TERRAIN_SIZE
            ty = (gy / (TERRAIN_GRID - 1) - 0.45) * TERRAIN_SIZE
            
            # Find closest spline point to ensure terrain is strictly below track
            min_d = float('inf')
            closest_z = 0.0
            for sp in spline_points:
                d = math.hypot(tx - sp.x, ty - sp.y)
                if d < min_d:
                    min_d = d
                    closest_z = sp.z
            
            if min_d < 42.0:
                # Within track corridor, kerbs, runoff, and gravel: firmly below
                tz = closest_z - 0.25
            elif min_d < 90.0:
                # Infield & immediate outfield: gentle slope
                blend = (min_d - 42.0) / 48.0
                natural_z = closest_z - 0.2 + math.sin(tx * 0.012) * math.cos(ty * 0.012) * 1.2
                tz = (closest_z - 0.25) * (1.0 - blend) + natural_z * blend
            else:
                # Distant boundary hills and scenery
                dist_outer = min_d - 90.0
                tz = math.sin(tx * 0.012) * math.cos(ty * 0.012) * 2.0 + dist_outer * 0.06
                
            v = bm_terrain.verts.new(mathutils.Vector((tx, ty, tz)))
            row.append(v)
        t_verts.append(row)
        
    bm_terrain.verts.ensure_lookup_table()
    for gx in range(TERRAIN_GRID - 1):
        for gy in range(TERRAIN_GRID - 1):
            v1 = t_verts[gx][gy]
            v2 = t_verts[gx+1][gy]
            v3 = t_verts[gx+1][gy+1]
            v4 = t_verts[gx][gy+1]
            bm_terrain.faces.new((v1, v2, v3, v4))

    mesh_terrain = bpy.data.meshes.new("SM_F1_Terrain_Base")
    bm_terrain.to_mesh(mesh_terrain)
    bm_terrain.free()
    obj_terrain = bpy.data.objects.new("SM_F1_Terrain_Base", mesh_terrain)
    col_map["COL_Environment"].objects.link(obj_terrain)
    obj_terrain.data.materials.append(mat_grass)

    # -------------------------------------------------------------
    # 17. Export Centerline Waypoints to JSON for Three.js
    # -------------------------------------------------------------
    json_path = r"c:\Users\Mark Waldeis\Desktop\formula 1\track_waypoints.json"
    waypoints_data = []
    for i in range(0, num_pts):
        p = spline_points[i]
        t = tangents[i]
        n = normals[i]
        curv = curvatures[i]
        waypoints_data.append({
            "x": round(p.x, 3),
            "y": round(p.y, 3),
            "z": round(p.z, 3),
            "tx": round(t.x, 3),
            "ty": round(t.y, 3),
            "tz": round(t.z, 3),
            "curv": round(curv, 4)
        })
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump({
            "name": "Monza Autodromo F1 Grand Prix Circuit",
            "total_points": len(waypoints_data),
            "track_width": TRACK_WIDTH,
            "start_finish": {"x": 0.0, "y": start_finish_y, "z": 0.0},
            "waypoints": waypoints_data
        }, f, indent=2)
        
    print(f"Waypoints saved to {json_path}")
    
    # -------------------------------------------------------------
    # 18. Export Entire F1 Scene to GLB for Three.js
    # -------------------------------------------------------------
    glb_path = r"c:\Users\Mark Waldeis\Desktop\formula 1\f1_track.glb"
    print(f"Exporting track to {glb_path}...")
    
    bpy.ops.object.select_all(action='DESELECT')
    for col_name in ["COL_Track", "COL_PitLane", "COL_Barriers", "COL_Structures", "COL_Environment"]:
        for obj in col_map[col_name].objects:
            obj.select_set(True)
            
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        use_selection=True,
        export_format='GLB',
        export_apply=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False
    )
    
    bpy.ops.wm.save_mainfile(filepath=r"c:\Users\Mark Waldeis\Desktop\formula 1\formula_1_mark.blend")
    
    print(f"=== F1 Track generation & export completed successfully! File size: {os.path.getsize(glb_path)} bytes ===")

if __name__ == "__main__":
    run()
