# Storybook asset audit

This audit covers the ZIPs in `new models`, supplemented by the game art ZIPs in Downloads. All Kenney packs used in the branch include CC0 notices. The selected GLBs, referenced palettes and original license notices are grouped by pack under `public/models/`.

| Pack | Contents reviewed | Decision |
| --- | --- | --- |
| Fantasy Town Kit 2.0 | 167 GLBs for modular houses, markets, plants and furniture | **Use** the two canopied stalls, cart, timber shutters, chimneys, banner, hedge and round tree for Solstice Haven. The modular pieces fit the existing cottage footprints. |
| Castle Kit | 76 GLBs for battlements, towers, bridges and rocks | **Use** shorter wall modules and banners as town accents and large rocks at Skyridge. Keep the existing gate layouts because the roads and collision are tied to those openings. |
| Food Kit | 200 GLBs for full ingredients, household items and food props | **Use** the apples, bread and barrel. They dress the market without adding a new interaction or inventory item. |
| Mini Forest | 22 GLBs for trees, rocks, fences, bridges and platforms | **Use** both tree silhouettes and the low stones around Whispering Glade. Keep the wood structure family for reference. |
| Mini Dungeon | 30 GLBs for ruins, gates, props and small characters | **Use** columns, stone piles and a barrel at the Sunken Sun-Ruins. |
| Mini Arena | 22 GLBs for arena walls, floor pieces, columns and banners | **Use** the damaged column and banner in the ruins. Small shapes leave the arena center readable. |
| Modular Cave Kit | 40 GLBs for rock gates, corridors, stairways and cave rooms | **Use** the rock arch and rock detail on Skyridge. Keep the full corridors for reference where they can support future interiors. |
| Nature Kit | 329 GLBs for plants, cliffs, ground and water features | **Use** red mushrooms and purple flowers. The existing terrain continues to match the game’s height and collision calculations. |
| Graveyard Kit | 91 GLBs for urns, pillars, walls, crypts and figures | **Use** the urn and obelisk in the ruins. The rest of the graveyard set stays optional for another region. |
| Mini Characters | 43 GLBs for people, gear, props and mobility aids | **Adapt** the knight and two villagers. The figures have skins and useful motion clips. The knight keeps Ashen Tangent’s weapon and camera behavior. Lyra and Eldrin get their own tint and stature. Aurelius and Theron keep their custom silhouettes and equipment. |
| Blocky Characters 2.0 | 18 GLBs with node animation and deliberately rigid proportions | **Reference** for the toybox silhouette. Mini Characters provide more expressive faces and an easier match for the existing movement. |
| Modular Dungeon Kit | 39 GLBs of walls, gates, rooms and corridors | **Reference** for masonry forms. Its room modules suit enclosed dungeons. |
| Holiday Kit | 99 seasonal GLBs | **Skip** seasonal props for this pass. |
| Pirate Kit | 72 GLBs with a nautical theme | **Skip** the nautical props for these inland regions. |
| Prototype Kit | 145 GLBs for blockouts | **Reference** for scale and prototype layouts. |
| Low-Poly Medieval Fantasy NPC Pack | Unity package with 37 FBXs, premade characters, palette PNGs and Unity-specific materials and controllers | **Reference**. The FBX geometry is a conversion candidate, but the archive lacks GLB and verified publisher entitlement for this copy. No converted material or animation was selected. [Publisher listing](https://assetstore.unity.com/packages/3d/characters/low-poly-medieval-fantasy-npc-pack-317450) |
| Low-Poly Medieval Fantasy Biped Creatures Pack | Unity package with 27 FBXs, monster prefabs, one palette PNG and Unity material and controller files | **Reference**. The geometry is a conversion candidate. The publisher lists the rigged creatures without included animations. The game keeps custom guardian rigs, and this archive lacks verified publisher entitlement. [Publisher catalog](https://assetstore-fallback.unity.com/publishers/101065) |
| 2D Pixel Dungeon Asset Pack v2.0 | 183 pixel tiles, props and sprite PNGs | **Reference** the compact inventory silhouettes. Keep the game’s UI art at its existing display resolution. [Creator page](https://pixel-poem.itch.io/dungeon-assetpuck) |
| Debts in the Depths Assets | 56 animation sources with PNG and GIF versions | **Skip** game-specific sprites. Standalone reuse terms were absent from the archive. |
| Pixel Crawler Free Pack 2.11 | 181 PNGs and 190 Aseprite sources with a terms file | **Reference** the 16×16 item shapes. The new interface uses the game’s existing vector and HTML elements. [Creator page](https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites) |
| Tiny RPG Free Soldier and Orc | 34 PNGs and four animation sources | **Reference** readable armor silhouettes. The in-game models are 3D. [Creator page](https://zerie.itch.io/tiny-rpg-character-asset-pack) |
| Tiny RPG Free Demon and Blood Monster | 28 PNGs and four animation sources | **Skip** these creature sprites. Keep the three guardians’ existing rigs and identities. |
| Fancy Recipe Book OreUI and Gui’s HUD & UI Edition | Two resource packs with 24 and 346 PNGs respectively, plus Minecraft resource metadata | **Skip** the interface sprites. Use the original Astrolabe palette, typography, and design across all game screens. |

The complete copies in `new models` supersede the zero-byte Kenney duplicates previously seen elsewhere in Downloads. The branch includes game-ready CC0 selections only.

## Matched Chrome render comparison

Low preset, same fixed plaza camera and renderer. These figures count submitted draw calls and triangles for one frame.

| Viewport | Current draw calls | Overhaul draw calls | Current triangles | Overhaul triangles |
| --- | ---: | ---: | ---: | ---: |
| Desktop | 1,223 | 1,109 | 154,342 | 154,877 |
| Phone-sized touch viewport | 756 | 743 | 136,036 | 137,596 |

The 31 selected GLBs total approximately 1.31 MB. The highest source mesh count is 924 triangles for a villager base. Costumes and repeated environment pieces use low-poly geometry and instancing.
