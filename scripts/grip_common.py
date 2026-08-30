#!/usr/bin/env python3
"""Shared constants for the GRIP website build pipeline (grip_scan / grip_validate).

The downloaded suite folder is SOURCE DATA: read-only, never modified, never
committed to this repo (see .gitignore). All outputs go to data/grip/.

Category table transcribed from the suite README section 2 and verified against
the actual folders + annotations.jsonl contents (2026-08-30, plan-germetrical.md).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = ROOT / "Geomatric-Reasoning-Benchmark-Dataset-main"
SUITE_DATA_DIR = DATASET_DIR / "Dataset"
OUT_DIR = ROOT / "data" / "grip"
PUBLIC_DIR = ROOT / "apps" / "grip-web" / "public" / "data"
OVERRIDES_DIR = ROOT / "data" / "grip-overrides"
UPSTREAM_REPO = "bilaljawaid980/Geomatric-Reasoning-Benchmark-Dataset"
UPSTREAM_OVERRIDES_PREFIX = "data/overrides"

# slug -> (folder, display name, family, geometry class)
CATEGORIES: dict[str, tuple[str, str, str, str]] = {
    "route":               ("route_dataset_3000",             "Route Puzzles",             "geometric", "Topology / Graph Theory"),
    "nested_squares":      ("nested_squares_dataset_3000",    "Nested Squares",            "geometric", "Transformational Geometry"),
    "nested_triangles":    ("nested_triangles_dataset_3000",  "Nested Triangles",          "geometric", "Transformational Geometry"),
    "nested_hexagons":     ("nested_hexagons_dataset_3000",   "Nested Hexagons",           "geometric", "Transformational Geometry"),
    "cube_structure":      ("cube_structure_dataset_3000",    "Cube Structure",            "geometric", "Solid Geometry"),
    "line_intersection":   ("line_intersection_dataset_3000", "Line Intersections",        "geometric", "Plane Geometry"),
    "overlap_circles":     ("overlap_circles_dataset_3000",   "Overlapping Circles",       "geometric", "Plane Geometry"),
    "cube_net":            ("cube_net_dataset_3000",          "Cube Nets",                 "geometric", "Solid Geometry"),
    "shadow_inference":    ("shadow_inference_dataset_3000",  "Shadow Inference",          "geometric", "Projective Geometry"),
    "impossible_object":   ("impossible_object_dataset_3000", "Impossible Objects",        "geometric", "Solid Geometry"),
    "polyhedron":          ("polyhedron_dataset_3000",        "Polyhedra",                 "geometric", "Solid Geometry"),
    "depth_height":        ("depth_height_dataset_3000",      "Depth & Height",            "geometric", "Projective Geometry"),
    "embedded_figures":    ("embedded_figures_dataset_3000",  "Embedded Figures",          "geometric", "Plane Geometry — Composition"),
    "rotation_matching":   ("rotation_matching_dataset_3000", "Rotation Matching",         "geometric", "Transformational Geometry"),
    "combination":         ("combination_dataset_3000",       "2D Combination",            "geometric", "Plane Geometry — Composition"),
    "combination3d":       ("combination3d_dataset_3000",     "3D Combination",            "geometric", "Solid Geometry"),
    "fold_punch":          ("fold_punch_dataset_3000",        "Fold & Punch",              "geometric", "Transformational Geometry"),
    "symmetry_pattern":    ("symmetry_pattern_dataset_3000",  "Symmetry Patterns",         "geometric", "Transformational Geometry"),
    "occluded_pattern":    ("occluded_pattern_dataset_3000",  "Occluded Patterns",         "geometric", "Plane Geometry"),
    "angle_estimation":    ("angle_estimation_dataset_3000",  "Angle Estimation",          "geometric", "Plane Geometry — Angles"),
    "coordinate_geometry": ("coordinate_geometry_dataset_3000", "Coordinate Geometry",     "geometric", "Analytic / Coordinate Geometry"),
    "orthographic":        ("orthographic_dataset_3000",      "Orthographic Projection",   "geometric", "Solid Geometry — Multi-View"),
    "rpm":                 ("rpm_dataset_3000",               "Raven-like Matrices",       "geometric", "Inductive / Analogical Reasoning"),
    "surface_topology":    ("surface_topology_dataset_3000",  "Surface Topology",          "geometric", "Surface Topology"),
    "gear_train":          ("gear_train_dataset_3000",        "Gear Trains",               "physical",  "Physical / Mechanical Reasoning"),
    "physical_stability":  ("physical_stability_dataset_3000", "Physical Stability",       "physical",  "Physical / Mechanical Reasoning"),
    "fbd":                 ("fbd_dataset_3000",               "Free-Body Diagrams",        "physical",  "Physical / Mechanical Reasoning"),
    "clock_reading":       ("clock_reading_dataset_3000",     "Clock Reading",             "physical",  "Physical / Mechanical Reasoning"),
    "gauge_reading":       ("gauge_reading_dataset_3000",     "Gauge Reading",             "physical",  "Physical / Mechanical Reasoning"),
    "optical_illusion":    ("optical_illusion_dataset_3000",  "Optical Illusions",         "geometric", "Plane Geometry / Visual Perception"),
    "compass_bearing":     ("compass_bearing_dataset_3000",   "Compass Bearings",          "geometric", "Analytic Geometry / Navigation"),
    "hex_pathfinding":     ("hex_pathfinding_dataset_3000",   "Hex Pathfinding",           "geometric", "Topology / Graph Theory"),
    "laser_mirror":        ("laser_mirror_dataset_3000",      "Laser & Mirror",            "geometric", "Plane Geometry / Physical Optics"),
    "projectile_motion":   ("projectile_motion_dataset_1000", "Projectile Motion",         "physical",  "Physical / Mechanical Reasoning"),
}

LEVEL_NAMES = {
    1: "Simple Description",
    2: "Basic Relational",
    3: "Comparative/Structural",
    4: "Compound Reasoning",
    5: "Extrapolative/Counterfactual",
}


def ensure_out_dir() -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUT_DIR
