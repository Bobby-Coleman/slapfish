# Slap Fish: Game Design and Balance

Every number in this doc lives in `shared/sim.js` (`CFG`, `TIERS`, `WEAPONS`, `DROPS`). If they disagree, the code wins and this doc needs an update. Run `npm run sim` for fresh bot-vs-bot stats.

## Pitch

You and your friends spawn on a wooden pier in the middle of the ocean, seen over your character's shoulder like How to Fish. Rods sit on a rack in the center. Grab one, run to an edge, and cast. Every fish you pull up is a weapon: a sardine pistol, a squid ink blaster, a swordfish blade, a shark rocket. When the fish runs out of ammo you go fishing again. The longer your line stays in, the deeper it sinks and the rarer the fish, but while you're fishing you're rooted to the edge of a pier and one hit snaps your line.

Fights work like Super Smash Bros. in 3D. Every hit raises your damage %, and the higher it is, the farther the next hit launches you. Landing in the water isn't a knockout: you swim back and climb onto the pier. You're only knocked out when you're launched past the ring of buoys that marks the edge of the map. Most knockouts at the end of the round wins.

## Design pillars

1. **Greed is the main decision.** Every cast asks "how long can I afford to wait?" The answer depends on where the other players are, what they're holding, and what gear you have.
2. **Luck evens out over a round.** A 10-minute round should contain roughly 10 to 15 fish per player, so one lucky legendary decides a fight but not the match.
3. **Readable chaos.** Low-poly toon art, big silhouettes per fish, a colored ring for every player, rarity colors everywhere (gray, green, blue, purple, gold).
4. **Anyone can win a fight with the right fish.** Unarmed players can still slap. Light fish build up damage %, heavy fish finish people off, so a well-timed common can steal a KO from a legendary.
5. **Falling in is a setback, not a death.** Swimming back costs time and leaves you open to being knocked farther out while you climb, which is where most KOs come from.

## What I borrowed, and from where

| Game | Mechanic | How Slap Fish uses it |
|---|---|---|
| Brawlhalla | Item spawns scale with player count; spawn rate slows as more items are on the map; trailing players get help | Rod rack holds players + 1 rods (min 3, max 6). Pelican drops on a timer. Players 3+ KOs behind the leader get a faster-sinking line. |
| Fortnite (fishing) | Fishing as a loot source; casting into special "fishing holes" gives better loot than plain water | Pier tips are deep water: the line sinks 35% faster, but the tip is a dead end where you're easy to corner. |
| Splatoon | Ink slows enemies; strong visual identity per weapon | Squid Ink Blaster slows hit players by 40% for 2 s. |
| Duck Game / Stick Fight | Weapons drop from the sky; limited ammo forces you back into the loot loop; one hit can turn a round | Pelicans drop crates with a 3-4 s shadow warning. Every fish has limited uses, then it flops away. |
| Super Smash Bros. | Damage % instead of health; knockback grows with %; KO only past the blast zone; recovering back to the stage | Damage % with no cap. Launch power = knockback x (1 + % / 100). The blast zone is a buoy ring 40 units out. Water is the "off-stage": you swim back and climb up, and opponents can edge-guard you. |
| How to Fish | Third-person casting off a dock, bright low-poly look | Over-the-shoulder camera with mouse look; the bobber, line and fish come right up to the camera. |
| Mario Kart | Rubber-banding item odds for players at the back | Catch-up line speed bonus (below). |

Sources: [Brawlhalla item spawning](https://brawlhalla.wiki.gg/wiki/Item_Spawning), [Fortnite fishing holes](https://fortnite.fandom.com/wiki/Fishing_Hole), [Duck Game presents](https://duckgame.fandom.com/wiki/Present).

## Core loop

1. Spawn on the central platform (the spawn point farthest from enemies) with 1.5 s of invulnerability.
2. Run to the rod rack in the middle. Rods respawn on the rack 6 s after being taken.
3. Walk to any edge and cast (R or right-click). You're rooted while fishing.
4. Reel in (R again) whenever you like after 2.5 s. Reel while the bobber is pulled under for a perfect catch (+25% ammo). Reeling takes 0.6 s and you're still vulnerable.
5. Fight with your fish until its uses run out, then go back to step 3. You keep your rod until you die.
6. Get hit enough and you'll be launched. Land on the pier and keep fighting; land in the water and swim back (3.4 speed), then climb out (0.5 s, still hittable).
7. Get launched past the buoy ring and you're KO'd. Your fish and rod are lost at sea, your damage resets to 0%, and you respawn after 5 s. The last player to hit you in the previous 8 s gets the KO.

## The fishing risk window

| Rule | Value | Why |
|---|---|---|
| First possible bite | 2.5 s | A quick cast always works. You're never more than a few seconds from a weapon. |
| Reel-in time | 0.6 s | A short committal window, so reeling in when an enemy is on top of you is a real decision. |
| Auto reel | 30 s | Stops anyone from camping forever. |
| Getting hit while fishing | Line snaps, cast is lost, you still take damage and knockback | This is the main risk. |
| Cancel | R before the first bite, or Space to dash out at any time | You can always bail, but you lose the cast. |
| Pier tip bonus | Depth gain x1.35 | Rewards the most exposed spots. |
| Catch-up bonus | Depth gain x1.25 if you're 3+ KOs behind the leader | Gentle rubber-banding. It helps you fish better; it doesn't hand out wins. |
| Golden Lure (drop) | Depth gain x2 for the next 2 casts | Shortens your exposure. |
| Bubble Bobber (drop) | Next fishing trip blocks 2 hits completely | The "armor while fishing" item. |
| Bites | After 2.5 s the bobber gets pulled under every 2 to 4.5 s for 0.55 s | Reeling during a bite is a **perfect catch**: +25% ammo. A small skill reward that never changes rarity odds. |

### Depth tiers and rarity odds

Depth is "seconds in the water" times any multipliers.

| Tier | Depth | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|---|
| Shallows | 2.5 to 6 s | 70% | 25% | 5% | 0% | 0% |
| Reef | 6 to 12 s | 35% | 42% | 20% | 3% | 0% |
| Deep | 12 to 20 s | 12% | 33% | 38% | 15% | 2% |
| Abyss | 20 s+ | 3% | 17% | 40% | 30% | 10% |

At a pier tip with no other bonuses, Abyss starts after about 15 seconds instead of 20.

## Fish weapons

Rarity buys effectiveness (knockback, area, auto-aim, stun), not just more raw damage. Raw damage budgets (damage x pellets x uses) stay in a 180 to 385 band for every fish so no single fish is a guaranteed win.

| Fish | Rarity | Type | Damage | Knockback | Cooldown | Uses | Damage budget | Notes |
|---|---|---|---|---|---|---|---|---|
| Slap (no fish) | none | melee | 6 | 7 | 0.45 s | unlimited | | Always available. |
| Sardine Shooter | common | projectile | 8 | 3.5 | 0.25 s | 28 | 224 | Fast, short range. |
| Mackerel Slapper | common | melee | 12 | 10 | 0.5 s | 20 | 240 | The namesake slap. |
| Squid Ink Blaster | uncommon | 3-pellet spray | 6 x3 | 2 | 0.3 s | 25 | 450 | Slows by 40% for 2 s. Hard to land every pellet. |
| Pufferfish Grenade | uncommon | lobbed area | 30 | 17 | 0.9 s | 8 | 240 | Lands where you aim, 3.4 radius. |
| Swordfish | rare | lunging melee | 22 | 17 | 0.65 s | 16 | 352 | Dashes you forward on every swing. |
| Tuna Cannon | rare | heavy projectile | 18 | 22 | 0.95 s | 10 | 180 | Low damage, huge ring-out power. |
| Hammerhead | epic | ground slam | 32 | 24 | 1.1 s | 12 | 384 | Area hit in front of you. Slows your walk to 6.0. |
| Electric Eel | epic | auto-aim zap | 13 | 6 | 0.5 s | 20 | 260 | Chains to a second target, 0.5 s stun. |
| Shark Rocket | legendary | explosive | 38 | 28 | 1.25 s | 7 | 266 | 3.6 radius blast, falloff to 50% at the edge. |
| Golden Narwhal | legendary | piercing lance | 45 | 22 | 1.3 s | 7 | 315 | Very fast, passes through everyone in a line. |

Damage adds to the target's damage %. Area damage falls off to 50% at the edge of the blast. Launch power is `knockback x (1 + damage% / 100)` (x0.8 while wearing a Crab Shell). Above 6 power you're launched into the air with 45% of the power going upward; below it you just slide. Weak, fast fish (Sardine, Squid) build damage; heavy fish (Tuna, Hammerhead, Shark) score KOs. Measured launch distances from the middle of the pier (the buoy ring is 40 out, pier tips are 28 out):

| Knockback | 0% | 50% | 100% | 150% | 200% |
|---|---|---|---|---|---|
| 3.5 (Sardine) | 0 | 0 | 4 | 4 | 5 |
| 10 (Mackerel) | 5 | 8 | 13 | 16 | 23 |
| 17 (Puffer, Swordfish) | 10 | 16 | 27 | 39 | KO |
| 22 (Tuna) | 14 | 26 | KO | KO | KO |
| 28 (Shark) | 21 | 39 | KO | KO | KO |

So fighting out on a pier tip is far riskier than fighting in the middle.

## Pelican air drops

A pelican flies in every 40 s (plus or minus 10 s; the first at 25 s). Its drop target shows on the pier and the minimap about 3.5 s before the crate lands. Half of all drops land on the long piers, which pulls people into exposed spots.

| Drop | Chance | Effect |
|---|---|---|
| Fish & Chips | 28% | Heals 30% damage |
| Crab Shell | 24% | Armor to 50. Armor absorbs damage before it adds to your %, and cuts knockback by 20% while it lasts. |
| Bubble Bobber | 20% | Your next fishing trip blocks 2 hits entirely |
| Golden Lure | 16% | Your next 2 casts sink twice as fast |
| Mystery Cooler | 12% | A random fish: rare 60%, epic 30%, legendary 10% |

## Players and the arena

| Rule | Value |
|---|---|
| Damage | Starts at 0%, no cap, resets on KO |
| Armor cap | 50 |
| Walk speed | 7.2 (6.0 with a Hammerhead, 60% when inked) |
| Dash | Speed 19 for 0.16 s, 1.4 s cooldown. Also cancels fishing. |
| Respawn | 5 s, then 1.5 s of invulnerability |
| KO | Launched (or pushed while swimming) past the buoy ring at 40 units from the center |
| KO credit | The last player to hit you within 8 s |
| Gravity | 30. You have a little air control (DI) while flying. |
| Water | Swim speed 3.4. Touch the pier to climb out (0.5 s). Hits in the water push you farther out. |
| Walking off the edge | Not possible. Only knockback can push you off. |
| Arena | 24 x 24 central platform, four 6-wide piers out to 28 units. Barrels give cover. |

### Round and scoring

- Rounds last 10 minutes by default (3 and 5 minute options for quick games).
- Most KOs wins. Fewer times KO'd breaks a tie. If still tied, overtime runs for up to 60 s until someone pulls ahead.

## Pacing targets and what the bots show

Targets for a 2-player, 10-minute round:

- 10 to 15 fish caught per player.
- About one KO per player every 1 to 2 minutes, with several splashdowns between KOs.
- Rare-or-better fish should score noticeably more KOs per fish than commons, without any single fish deciding the match.

Headless bot-vs-bot results with the current numbers (`npm run sim`, 8 rounds, 2 normal bots), per player per 10 minutes: about 16 fish, 5 KOs taken and 21 splashdowns. KOs per fish run from 0 for the Sardine and Squid (they build damage) to about 0.2 for the Mackerel, 0.35 for the Puffer, 0.7 to 0.8 for the Swordfish, Tuna and Hammerhead, and about 1 for legendaries.

Bots don't edge-guard on purpose and swim straight home, so they KO each other less than people will. The real check is a human playtest. Levers, in order: `CFG.kbScale` and `CFG.blastRadius` for KO pace, `CFG.usesScale` for fish per round, then individual fish knockback.

## Things to decide next

- Teams (2v2) or free-for-all only?
- Should the rod also break after N casts, so the rack stays contested all round?
- A recovery move (a double jump or a "fish flop" up the side of the pier) so good players can save themselves at high %.
- More gear for fishing, such as a "Tackle Box" that adds 50% depth gain but makes you glow on the minimap.
- Map hazards: a wave that washes over one pier every couple of minutes, or a shark circling the deep tips that snaps lines at random.
- Controller and touch controls.
