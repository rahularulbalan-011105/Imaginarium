// ─────────────────────────────────────────────────────────────────────────────
// weaponRegistry — data-driven weapon definitions.
//
// A weapon is a plain record + a firing strategy (ray | rocket | flame). Adding a
// weapon = one registerWeapon({...}) call; the engine (WeaponManager, Projectile
// Manager, ExplosionSystem, DamageManager) needs no change. All damage numbers
// live here so combat feel is tuned in one place.
//
// Fields:
//   key, name, class, model            // model = lazy weapon GLB key (modelLoader)
//   strategy: 'ray'|'rocket'|'flame'
//   damage: { armor, core, stability, heat }   // per shot / pellet / rocket / tick
//   range, fireRateHz, magSize, reloadMs
//   pellets, spreadDeg, burst          // ray spread / rocket burst
//   heatPerShot                        // heat added to the shooter
//   recoil, knockback                  // self impulse / target impulse (su·mass)
//   projectileSpeed, splashRadius, selfDamage   // rockets
//   statusEffects: [{type,magnitude,durationMs,dps}]   // applied to the TARGET
//   selfStatus:    [{type,magnitude,durationMs}]       // applied to the SHOOTER
//   crit, critMul, muzzleY             // crit on exposed core / weapon mount height
// ─────────────────────────────────────────────────────────────────────────────

const _registry = {}

export function registerWeapon(def) { _registry[def.key] = def; return def }
export function getWeapon(key) { return _registry[key] || null }
export function allWeapons() { return Object.values(_registry) }

// Weapons are placed in the editor as scene objects of type `weapon_<key>`
// (e.g. 'weapon_autocannon'), attached to the robot. The arena reads them off
// each robot's assembly — no in-battle picker.
export function weaponForType(type) {
  if (typeof type !== 'string' || !type.startsWith('weapon_')) return null
  return getWeapon(type.slice('weapon_'.length))
}
export function isWeaponType(type) { return typeof type === 'string' && type.startsWith('weapon_') }
export function weaponTypes() { return allWeapons().map(w => 'weapon_' + w.key) }

// ── AUTO CANNON — sustained DPS, armor break, crit on exposed core ────────────
registerWeapon({
  key: 'autocannon', name: 'Auto Cannon', class: 'sustained', model: 'weapon_autocannon',
  strategy: 'ray',
  damage: { armor: 5, core: 3, stability: 1, heat: 0 },
  range: 70, fireRateHz: 8, magSize: 45, reloadMs: 1600,
  pellets: 1, spreadDeg: 1.6,          // progressive recoil grows this while firing
  heatPerShot: 2.4, recoil: 2, knockback: 1.5,
  crit: true, critMul: 1.8, muzzleY: 1.4,
  statusEffects: [], selfStatus: [],
})

// ── SHOTGUN — burst damage, high stability + armor break, strong knockback ────
registerWeapon({
  key: 'shotgun', name: 'Shotgun', class: 'burst', model: 'weapon_shotgun',
  strategy: 'ray',
  damage: { armor: 6, core: 2, stability: 3, heat: 0 },   // per pellet
  range: 24, fireRateHz: 1.2, magSize: 6, reloadMs: 1800,
  pellets: 9, spreadDeg: 16,
  heatPerShot: 6, recoil: 9, knockback: 10,
  crit: true, critMul: 1.4, muzzleY: 1.3,
  statusEffects: [{ type: 'slow', magnitude: 0.25, durationMs: 500 }],
  selfStatus: [],
})

// ── ROCKET POD — area damage, splash + explosion, self-damage, slow reload ────
registerWeapon({
  key: 'rocket', name: 'Rocket Pod', class: 'area', model: 'weapon_rocket',
  strategy: 'rocket',
  damage: { armor: 20, core: 14, stability: 20, heat: 6 },   // explosion, at centre
  range: 90, fireRateHz: 2.5, magSize: 3, reloadMs: 3200,
  burst: 3, spreadDeg: 3,
  heatPerShot: 8, recoil: 4, knockback: 24,
  projectileSpeed: 55, splashRadius: 11, selfDamage: { core: 8 },
  crit: false, muzzleY: 1.5,
  statusEffects: [], selfStatus: [],
})

// ── FLAMETHROWER — area denial, burn, close range, slows self while firing ────
registerWeapon({
  key: 'flame', name: 'Flamethrower', class: 'denial', model: 'weapon_flame',
  strategy: 'flame',
  damage: { armor: 1, core: 1, stability: 1, heat: 0 },      // per tick per target
  range: 15, fireRateHz: 14, magSize: 140, reloadMs: 2600,
  pellets: 4, spreadDeg: 26,           // cone rays
  heatPerShot: 1.3, recoil: 0, knockback: 0,
  crit: false, muzzleY: 1.2,
  statusEffects: [{ type: 'burning', dps: 9, durationMs: 2200 }],
  selfStatus:    [{ type: 'slow', magnitude: 0.4, durationMs: 160 }],   // slow while firing
})
