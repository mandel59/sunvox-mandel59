# Generated SunVox Assets

This directory is for generated SunVox assets that are intentionally checked in
and distributed. Codex is used to produce recipes under `generated/recipes/`;
project tools build selected `.sunsynth` and `.sunvox` outputs from those
recipes.

- `generated/instruments/`: generated `.sunsynth` instruments selected for
  distribution.
- `generated/music/`: generated `.sunvox` projects selected for distribution.
- `generated/recipes/`: machine-generated recipes kept for reproducibility or
  as generated examples.

Use `var/` for temporary drafts, local experiments, and throwaway tool output.
Use `recipes/` for human-authored generation recipes.

Generated files should remain reproducible from checked-in recipes or tools
where practical, and should have their source recipe or source asset documented
in the relevant commit or local README. The files in this directory should not
be described as created by Ryusei Yamaguchi (@mandel59) unless they were
hand-authored separately from the generation workflow.
