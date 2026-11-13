# DEAD CIRCUIT architecture and data interfaces

Independent ES module game in `/deadcircuit/`. Do not edit Tidekeeper sources.
WebGL third-person over-the-shoulder tactical campaign, 18 genuinely different maps; all art/audio local/procedural.
Chinese UI and story. No dependencies at runtime. Keyboard, standard Gamepad, touch.

## Modules

- `game.js` handles the campaign, combat, snapshots and checkpoints; `input.js` unifies keyboard, controller and touch input.
- `levels.js` defines the hand-authored environments; `geometry.js` provides exact collision and navigation.
- `story.js` contains all narrative content and field documents; `audio.js` synthesizes local audio.
- `armory.js` owns weapon and attachment transactions; `enemies.js` defines roles; `ai.js` implements perception and tactics.
- `ui.js`, `style.css`, `index.html`, `input3d.js` and `render3d.js` present the third-person game; `render.js` supplies local interface illustrations.
- `build.mjs` creates the standalone HTML; `tests/` and `scripts/playtest.mjs` provide controlled regression and natural-input checks.

Coordinate system: world pixels, Y down, 64px tiles. The renderer maps X/Y to 3D X/Z at .02 meters per pixel; player ground navigation uses that plane and projectiles carry a separate height. Rectangles `{x,y,w,h}`. Actors have center `{x,y,r}`.

## Level interface

`LEVELS`: array 18 metadata objects `{id,title,subtitle,act,theme,minutes,mechanic,briefing}`.
`createLevel(id)` returns fresh mutable `{id,width,height,spawn:{x,y},exit:{x,y,r},theme,name,tiles?,walls:[],covers:[],doors:[],props:[],enemies:[],objects:[],stages:[],optional:[],floorZones:[],links:[]}`.
Walls `{id,x,y,w,h,material:'concrete'|'metal'|'glass'|'wood',hp?,active:true}`.
Covers `{id,x,y,w,h,low:true,hp?,material}`. Doors rect with `open:false,locked:false,hp:80`.
Objects `{id,x,y,r:24,type:'terminal'|'rescue'|'supply'|'evidence'|'switch'|'gate'|'vehicle'|'power'|'relay'|'crate'|'hostage',name,stage:0,interaction:1.5,optional:false,active:true,requires:[],effect?:{openDoors:[],disableHazards:[],moveCover:[],...}}`.
Enemy spawns `{id?,type,x,y,patrol?:[{x,y}],wave:0}`.
Stages array `{id,title,description,targets:[objectIds],reinforcements?:[enemySpawns],checkpoint:true,requiredKills?:0}`. No forced waits. Complete stages by interacting targets (possible guarding enemies/conditions), then next. Final stage is extraction (engine supplies). Object interactions can be progress while held; rescue can follow player to exit, vehicles follow waypoints. Mechanic effects should actually alter geometry/hazards, not just a label.
Floor zones rect `{type:'water'|'fire'|'electric'|'belt'|'fog'|'road'|'roof'|'interior',x,y,w,h,active:true,dx?,dy?}`.
geometry exports `clamp`, `distance`, `segmentRect`, `circleRect`, `lineOfSight(a,b,level,options?)`, `moveActor(actor,dx,dy,level,options?)`, `findPath(start,end,level,r=16)` (world-coordinate waypoints). Closed doors and active walls block; low covers block movement but not sight. Geometry functions pure except moveActor mutates actor. `moveActor` returns boolean.

## Armory interface

`WEAPONS`: array of 14 defs `{id,name,family,caliber,damage,rpm,mag,reload,spread,recoil,range,pellets:1,noise,color,unlockedAt,weight,penetration,burst?:1,description}`. Angles radians, noise/range world pixels, reload seconds.
`ATTACHMENTS`: array ~28 `{id,name,slot,description,allowedFamilies?,modifiers}`; slots muzzle/optic/underbarrel/magazine/stock/rail; modifiers described in module.
`weaponStats(id,fittings={})` -> full derived weapon def, `compatible(weaponId,attachmentId)` boolean.
`installAttachment(profile,weaponId,attachmentId)` and `removeAttachment(profile,weaponId,slot)` return `{ok,message}` and atomically mutate. Profile owns `ownedWeapons:[ids]`, `ownedAttachments:{id:count}`, `fittings:{weaponId:{slot:attachmentId}}`, `ammo:{weaponId:{mag,reserve}}`, `loadout:[primary,secondary]`.
`ENEMY_TYPES`: object 14+ roles across `security`, `infected`, `machine`, defs `{name,faction,hp,speed,r,range,damage,fireRate,vision,hearing,color,role,description}`.

## Game API for UI/render/AI

`new Game(canvas)` exposes `mode`, `profile`, `settings`, `campaign`, `level`, `player`, `enemies`, `bullets`, `effects`, `pickups`, `throwables`, `messages`, `camera`, `input`, `audio`, `ui`.
campaign `{mission:0,stage:0,completed:[],choices:{},flags:{},journal:[],deaths:0,totalPlay:0}`.
player `{x,y,r,hp,maxHp,armor,maxArmor,stamina,angle,stance:'stand'|'crouch',coverId:null,weaponIndex:0,action:null,invulnerable:0}`.
enemy `{id,type,faction,x,y,r,hp,maxHp,angle,state,awareness,targetId,patrol,ammo,cooldown,searchTime,suppression,dead:false}`.
bullets `{x,y,px,py,vx,vy,damage,life,faction,owner,r,penetration}`; effects `{x,y,type,life,maxLife,...}`.
`g.startNew(difficulty='standard')`, `g.continueGame()`, `g.startMission(id=campaign.mission)`, `g.prepareMission(id)`;
`g.showBriefing()`, `g.showLoadout()`, `g.showJournal()`, `g.showMenu()`, `g.pause()`, `g.resume()`, `g.save()`, `g.retry()`, `g.nextMission()`, `g.advanceDialogue(choiceIndex?)`, `g.skipDialogue()`, `g.setDifficulty(id)`, `g.setSetting(key,value)`, `g.startPractice()`.
`g.weaponStats(id?)`, `g.installAttachment(weaponId,attachmentId)`, `g.removeAttachment(weaponId,slot)`, `g.equipWeapon(slot,id)`.
`g.toast(text)`, `g.noise(x,y,radius,faction='player')`, `g.spawnEnemy(def)`, `g.damageActor(actor,n,source)`, `g.fireEnemy(enemy,target,options={})`, `g.moveEnemy(enemy,dx,dy)`, `g.hasSight(a,b)`, `g.getHostileTarget(enemy)`, `g.spawnEffect(type,x,y,extra={})`.
UI uses `new UI(g)` with `.render(mode=g.mode)` full modal, `.update()` lightweight HUD, `.dialogue(scene,index,choices?)`. Root sets `g.ui`.
Render uses `new Renderer(canvas)` with `.draw(g,dt)`, `.resize()`; render exports `portraitSVG(id,size?)` and `weaponSVG(id,size?)` optional.
Audio uses `new AudioEngine()` with `.unlock()`, `.sfx(name)`, `.setMuted(bool)`, `.update(g,dt)`, `.dispose()`.
AI exports `updateEnemies(g,dt)`; it may import geometry/enemies. Use game helper methods above for projectiles, movement, damage and sound; infected and security/machines fight each other, player is hostile to all except rescued NPCs. Nonlethal-looking hit effects, no gore.

UI DOM: canvas `#game`, overlay `#overlay`, HUD `#hud`, toast `#toast`, touch root `#touchControls`; agents may add child elements. Input key maps finalized by root. No forced ten-hour gate. 2–3h is a design target requiring honest actual play evidence.
