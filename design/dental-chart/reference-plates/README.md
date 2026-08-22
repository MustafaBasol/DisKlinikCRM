# Reference plates (not committed)

This directory holds ten raster study plates of permanent and deciduous tooth
morphology, one per family group, used while authoring the vector odontogram
assets in `src/components/odontogram/lateral/` and `.../occlusal/`.

They are **morphology guidance only**. They were never traced, are never
embedded in the application, and nothing under `src/` references them. The
shipped assets are hand-authored SVG path data built against the shared
coordinate system in `../AUTHORING.md`.

The plates themselves are gitignored (~10 MB of binaries that no build, test
or runtime path reads). Expected filenames:

```
01_adult_upper_incisors_canine_fdi_11_12_13_ref.png
02_adult_upper_premolars_fdi_14_15_ref.png
03_adult_upper_molars_fdi_16_17_18_ref.png
04_adult_lower_incisors_canine_fdi_41_42_43_ref.png
05_adult_lower_premolars_fdi_44_45_ref.png
06_adult_lower_molars_fdi_46_47_48_ref.png
07_primary_upper_incisors_canine_fdi_51_52_53_ref.png
08_primary_upper_molars_fdi_54_55_ref.png
09_primary_lower_incisors_canine_fdi_81_82_83_ref.png
10_primary_lower_molars_fdi_84_85_ref.png
```

Drop them back into this directory to re-derive or extend the artwork.
