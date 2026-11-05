# Asset pipeline

This build now uses the actual articulated character prefabs and animation clips from the Blackthornprod pack.

- Player: `Prefabs/Character (95).prefab` with its `idle`, `move`, and `attack` clips from `Animations/Character Anims (10)/` (the controller referenced by the prefab).
- Enemies: prefabs 70, 80, 41, 51, 31, 21, and 11 with the matching `idle`, `move`, and `attack` clips from their `Character Anims` folders.
- Scene: `Sprites/bg9.png`, color-tinted in Canvas behind the three lanes.

The Unity YAML curves are converted to 12-frame or 8-frame transparent PNG strips under `assets/`; each frame is composed from the prefab's SpriteRenderer pieces and the original clip's transform keyframes. `actors.json` identifies the strips, frame count, aspect ratio, and source clip duration. The browser game loops the idle/movement clips and plays the real attack pose when firing. This keeps the game lightweight while preserving the pack's assembled character art and motion in HTML5.

To regenerate the strips after changing the source prefabs or clips, install Pillow and run `python3 tools/export-lanes-assets.py` from the `gamehub` directory. The script reads the locally owned `Blackthornprod/100 Fantasy Characters Pack` folder next to `gamehub` and writes the game assets in place. Inspect all frames after export so empty frames cannot make characters flash during play.

Source pack: *100 Fantasy Characters Mega Pack* by Blackthornprod, Unity Asset Store product 222143. Usage remains subject to the user's Asset Store license and the Unity Asset Store EULA. Do not redistribute the source pack or its atlas separately.
