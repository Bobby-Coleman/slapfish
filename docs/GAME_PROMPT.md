# Slap Fish: the game prompt

This is what I think you want, written as one brief you could hand to any designer or developer (or back to me). The details are in [DESIGN.md](DESIGN.md). Open questions are at the end.

## The prompt

Build **Slap Fish**, an online multiplayer brawler you play in the browser. The vibe is a goofy, sunny, low-poly fishing game like *How to Fish*, but the fight works like *Super Smash Bros.* in 3D. Every weapon is a fish you caught yourself.

**Look and camera.** Bright toon-shaded low-poly art: a wooden pier on the open ocean, palm islands in the distance, rolling waves, pelicans. A third-person, over-the-shoulder camera behind your fisher like How to Fish. Mouse to look and aim with a crosshair, WASD to move. Touch controls on phones.

**Arena.** A square wooden platform in the middle with four long piers sticking out over deep water. A rack of fishing rods sits in the very center. Barrels give cover. Far out, a ring of buoys marks the edge of the world.

**Core loop.**
1. Everyone starts empty-handed. Run to the middle and grab a rod.
2. Run to any edge and cast. The longer your line stays in, the deeper it sinks: Shallows, Reef, Deep, then the Abyss. Deeper water gives rarer, stronger fish. Pier tips sink faster but are the most exposed spot on the map.
3. While you're fishing you're rooted and vulnerable. Getting hit snaps your line. Reeling in right when the bobber gets pulled under is a perfect catch with bonus ammo.
4. Your fish is your weapon. Each one has limited uses. When it runs out, go fish again.
5. That's the risk-versus-reward heart of the game: stay in for a legendary, or reel in a sardine now because someone is running at you.

**Combat is Smash-style.** Hits add to your damage %. The higher your %, the farther you fly. Light, fast fish build damage; heavy fish launch people. Landing in the water is not a KO: you swim back and climb out, like recovering to the stage. You only get KO'd if you're launched clear past the buoy ring. Then you respawn after a few seconds at 0%, and you lose whatever you were holding.

**Main fish (one at a time).** Ten fish weapons, from common to legendary, each with its own feel:
- Sardine pistol: rapid, tiny damage.
- Mackerel club: a solid melee slap.
- Squid ink shotgun: a spread that slows.
- Pufferfish grenade: lobbed and explodes.
- Swordfish sword: a lunge stab.
- Tuna cannonball: a big heavy shot.
- Hammerhead slam: a ground pound, but you move slower.
- Electric eel: chain lightning that stuns.
- Shark rocket: a big blast.
- Narwhal lance: a piercing beam.

**Gadget fish (a second slot, separate from your main fish).** Pulled up as bycatch or found in Tackle Boxes, used with Q:
- **Flounder Mine:** lay a flat fish on the boards. It blows up whoever steps on it.
- **Urchin Scatter:** throw a spray of spiky urchins that sting and slow.
- **Jellyfish Trap:** a jelly that zaps and bounces anyone who touches it.
- **Octopus Ink Bomb:** an ink cloud that slows people and hides their name and %.
- **Giant Clam Wall:** a clam you can hide behind while you fish.
- **Grouper Turret:** a grouper that sits there spitting bombs at the nearest enemy.

Gadgets work while you're fishing, so they're how you protect a long cast.

**Pelicans** fly over every 40 seconds or so and drop a crate, with its landing spot shown ahead of time. The crate holds one of: Fish & Chips (heals damage), Crab Shell (armor), Bubble Bobber (your next cast blocks two hits), Golden Lure (faster sinking), Mystery Cooler (a rare-or-better fish) or Tackle Box (a gadget). Many drops land on the far piers to pull people into danger.

**Win condition.** Most KOs when the timer ends. Rounds are 10 minutes by default (3 and 5 minute options). Overtime breaks ties. Players who fall behind sink their lines a little faster, so the game stays close without handing anyone a win.

**Pacing targets.** About 10 to 15 fish per player per round. Splashdowns are frequent; KOs are rarer and earned. No single fish should decide a match.

**Fairness.** Everyone starts equal and gets the same rods. Rarity comes only from taking more risk, never from luck alone or from unlocks. Every strong thing has a clear counter: dash out of fishing, armor against knockback, the clam against shots, and the ink cloud against focus fire.

**Online.** Rooms you join by name, up to 8 players, with one host starting the match. The server runs the real game so nobody can cheat by editing their client. Solo play against bots is there for practice.

## Open questions

Each one can be answered in a word. My pick is marked ★ and is what's built right now.

1. **Max players per room?** 4 · 6 · 8 ★
2. **Teams?** Free-for-all only ★ · add 2v2
3. **Win by?** Most KOs on a timer ★ · Smash-style stock lives (last one standing)
4. **Recovery move?** A double jump or "fish flop" to save yourself near the edge? Yes ★ (not built yet) · No
5. **Gadgets:** keep all six ★ · cut some · want more (ideas: a pufferfish you can sit on as a whoopee cushion, a crab that pinches and drags people, a sticky starfish that slows anyone stepping on it)
6. **Character looks?** Pick a color and hat ★ (later) · full customization · not needed
7. **Map hazards?** A rogue wave that washes over one pier every couple of minutes? Yes ★ · No
8. **Name stays "Slap Fish"?** Yes ★ · something else
