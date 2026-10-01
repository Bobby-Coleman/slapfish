# Slap Fish: Game Design and Balance

Every number in this doc lives in `shared/sim.js` (`CFG`, `TIERS`, `WEAPONS`, `DROPS`). If they disagree, the code wins and this doc needs an update. Run `npm run sim` for fresh bot-vs-bot stats.

## Pitch

You and your friends spawn on a wooden pier in the middle of the ocean. Rods sit on a rack in the center. Grab one, run to an edge, and cast. Every fish you pull up is a weapon: a sardine pistol, a squid ink blaster, a swordfish blade, a shark rocket. When the fish runs out of ammo you go fishing again. The longer your line stays in, the deeper it sinks and the rarer the fish, but while you're fishing you're rooted to the edge of a pier and one hit snaps your line. Knock people into the sea or slap them out to score.

## Design pillars

1. **Greed is the main decision.** Every cast asks "how long can I afford to wait?" The answer depends on where the other players are, what they're holding, and what gear you have.
2. **Luck evens out over a round.** A 10-minute round should contain roughly 10 to 15 fish per player, so one lucky legendary decides a fight but not the match.
3. **Readable chaos.** Low-poly toon art, big silhouettes per fish, a colored ring for every player, rarity colors everywhere (gray, green, blue, purple, gold).
4. **Anyone can win a fight with the right fish.** Unarmed players can still slap, and the pier edges mean a weak weapon with good knockback can beat a strong one.

## What I borrowed, and from where

| Game | Mechanic | How Slap Fish uses it |
|---|---|---|
| Brawlhalla | Item spawns scale with player count; spawn rate slows as more items are on the map; trailing players get help | Rod rack holds players + 1 rods (min 3, max 6). Pelican drops on a timer. Players 3+ KOs behind the leader get a faster-sinking line. |
| Fortnite (fishing) | Fishing as a loot source; casting into special "fishing holes" gives better loot than plain water | Pier tips are deep water: the line sinks 35% faster, but the tip is a dead end where you're easy to corner. |
| Splatoon | Ink slows enemies; strong visual identity per weapon | Squid Ink Blaster slows hit players by 40% for 2 s. |
| Duck Game / Stick Fight | Weapons drop from the sky; limited ammo forces you back into the loot loop; one hit can turn a round | Pelicans drop crates with a 3-4 s shadow warning. Every fish has limited uses, then it flops away. |
| Super Smash Bros. / Stick Fight | Ring-outs, knockback grows as you take damage | Knockback multiplier rises from 1x at full health to 2x near zero. Most KOs are ring-outs into the sea. |
| Mario Kart | Rubber-banding item odds for players at the back | Catch-up line speed bonus (below). |

Sources: [Brawlhalla item spawning](https://brawlhalla.wiki.gg/wiki/Item_Spawning), [Fortnite fishing holes](https://fortnite.fandom.com/wiki/Fishing_Hole), [Duck Game presents](https://duckgame.fandom.com/wiki/Present).

## Core loop

1. Spawn on the central platform (the spawn point farthest from enemies) with 1.5 s of invulnerability.
2. Run to the rod rack in the middle. Rods respawn on the rack 6 s after being taken.
3. Walk to any edge and cast (R or right-click). You're rooted while fishing.
4. Reel in (R again) whenever you like after 2.5 s. Reel while the bobber is pulled under for a perfect catch (+25% ammo). Reeling takes 0.6 s and you're still vulnerable.
5. Fight with your fish until its uses run out, then go back to step 3. You keep your rod until you die.
6. When you're KO'd, your fish and rod drop on the pier for anyone to grab (unless you fell in the sea, then they sink).

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

Area damage falls off to 50% at the edge of the blast. Knockback is multiplied by `0.7 x (1 + (1 - hp/100))`, so a nearly dead player flies twice as far as a fresh one.

## Pelican air drops

A pelican flies in every 40 s (plus or minus 10 s; the first at 25 s). Its drop target shows on the pier and the minimap about 3.5 s before the crate lands. Half of all drops land on the long piers, which pulls people into exposed spots.

| Drop | Chance | Effect |
|---|---|---|
| Fish & Chips | 28% | +45 health |
| Crab Shell | 24% | Armor to 50. Armor absorbs damage before health. |
| Bubble Bobber | 20% | Your next fishing trip blocks 2 hits entirely |
| Golden Lure | 16% | Your next 2 casts sink twice as fast |
| Mystery Cooler | 12% | A random fish: rare 60%, epic 30%, legendary 10% |

## Players and the arena

| Rule | Value |
|---|---|
| Health | 100 |
| Armor cap | 50 |
| Walk speed | 7.2 (6.0 with a Hammerhead, 60% when inked) |
| Dash | Speed 19 for 0.16 s, 1.4 s cooldown. Also cancels fishing. |
| Respawn | 5 s, then 1.5 s of invulnerability |
| Ring-out credit | The last player to hit you within 6 s gets the KO |
| Walking off the edge | Not possible. Only knockback can push you off. |
| Arena | 24 x 24 central platform, four 6-wide piers out to 28 units. Barrels give cover. |

### Round and scoring

- Rounds last 10 minutes by default (3 and 5 minute options for quick games).
- Most KOs wins. Fewer deaths breaks a tie. If still tied, overtime runs for up to 60 s until someone pulls ahead.

## Pacing targets and what the bots show

Targets for a 2-player, 10-minute round:

- 10 to 15 fish caught per player.
- One KO per player roughly every 40 to 60 seconds.
- Rare-or-better fish should get noticeably more KOs per fish than commons, without any single fish deciding the match.

Headless bot-vs-bot results with the current numbers (`npm run sim`, 10 rounds, 2 normal bots):

| Fish | Caught | KOs | KOs per fish |
|---|---|---|---|
| Sardine | 102 | 57 | 0.56 |
| Mackerel | 105 | 108 | 1.03 |
| Squid | 75 | 63 | 0.84 |
| Puffer | 75 | 51 | 0.68 |
| Swordfish | 44 | 54 | 1.23 |
| Tuna | 31 | 28 | 0.90 |
| Eel | 8 | 12 | 1.50 |

Mackerel's range was trimmed after this run. Bots catch about 22 fish and die about 20 times per player per round, which is well above the target. That's mostly because bots never retreat or kite, and both chase each other the whole round, so treat these as an upper bound. The real check is a human playtest. If humans also land above 15 fish per round, the levers in order are: `CFG.usesScale` (more ammo per fish), `CFG.dmgScale` (longer fights), then `CFG.kbScale` (fewer ring-outs).

Bots also almost never fish past the Reef, so the sims barely see epics and legendaries. The bot greed setting (`BOT_SKILL.greed`) controls that.

## Things to decide next

- Teams (2v2) or free-for-all only?
- Should the rod also break after N casts, so the rack stays contested all round?
- More gear for fishing, such as a "Tackle Box" that adds 50% depth gain but makes you glow on the minimap.
- Map hazards: a wave that washes over one pier every couple of minutes, or a shark circling the deep tips that snaps lines at random.
- Controller and touch controls.
