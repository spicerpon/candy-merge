/* Candy Merge 2048 — © KOGAMES. Built 2026-10-19T23:14Z. Source: src/ */
(function(){'use strict';
// ===== physics.js =====
// Lightweight position-based circle physics tuned for Suika-style merge games.
// World units: jar width ~7.2, gravity down (+y is down in this world to match canvas).

class Body {
  constructor(x, y, r, level) {
    this.x = x; this.y = y; this.px = x; this.py = y;
    this.vx = 0; this.vy = 0;
    this.r = r; this.tr = r; this.level = level;   // tr: target radius (grows in after a merge)
    this.mass = Math.max(0.25, r * r * 2.0);
    this.invMass = 1 / this.mass;
    this.angle = Math.random() * Math.PI * 2; this.av = 0;
    this.held = false;       // kinematic (hanging at the top)
    this.landed = false;     // touched anything after drop
    this.aboveTime = 0;      // seconds above the dead line while settled
    this.born = performance.now();
    this.scale = 1;          // visual pop scale
    this.dead = false;
    this.sleepT = 0;
  }
}

class World {
  constructor(opts) {
    this.left = opts.left; this.right = opts.right; this.floor = opts.floor; this.ceil = opts.ceil;
    this.gravity = opts.gravity ?? 26;
    this.restitution = opts.restitution ?? 0.12;
    this.friction = opts.friction ?? 0.28;
    this.drag = opts.drag ?? 0.004;
    this.maxPush = opts.maxPush ?? 7;   // max speed a resting body can gain from overlap correction per substep (u/s)
    this.maxSpeed = opts.maxSpeed ?? 22;
    this.maxBounce = opts.maxBounce ?? 3;   // max rebound speed after a hard landing (u/s)
    this.bodies = [];
    this.onContact = null;   // (a, b) => void, called once per frame per same-level touching pair
    this.onLand = null;      // (body) => void
    this.cell = 1.0;
  }

  add(b) { this.bodies.push(b); return b; }
  remove(b) { b.dead = true; const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }

  step(dt) {
    const sub = 4, h = dt / sub;
    for (let s = 0; s < sub; s++) this.substep(h);
  }

  substep(h) {
    const bs = this.bodies;
    // integrate
    for (const b of bs) {
      if (b.r < b.tr) b.r = Math.min(b.tr, b.r + (b.tr - b.r) * Math.min(1, 22 * h) + 0.003);
      if (b.held) { b.px = b.x; b.py = b.y; b.vx = b.vy = 0; continue; }
      b.vy += this.gravity * h;
      const d = 1 - this.drag;
      b.vx *= d; b.vy *= d;
      b.px = b.x; b.py = b.y;
      b.x += b.vx * h; b.y += b.vy * h;
    }
    // broadphase grid
    const grid = new Map();
    const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i]; if (b.held) continue;
      const c0x = Math.floor((b.x - b.r) / this.cell), c1x = Math.floor((b.x + b.r) / this.cell);
      const c0y = Math.floor((b.y - b.r) / this.cell), c1y = Math.floor((b.y + b.r) / this.cell);
      for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) {
        const k = key(cx, cy); let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(i);
      }
    }
    const pairs = new Set(); const contacts = [];
    for (const arr of grid.values()) {
      for (let a = 0; a < arr.length; a++) for (let c = a + 1; c < arr.length; c++) {
        const i = arr[a], j = arr[c]; const pk = i < j ? i * 100000 + j : j * 100000 + i;
        if (pairs.has(pk)) continue; pairs.add(pk);
        contacts.push([bs[i], bs[j]]);
      }
    }
    // solve positions (several iterations)
    const iters = 5;
    for (let it = 0; it < iters; it++) {
      for (const [a, b] of contacts) {
        let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy; const rr = a.r + b.r;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2); if (d < 1e-6) { dx = (Math.random() - 0.5) * 1e-3; dy = -1e-3; d = Math.sqrt(dx * dx + dy * dy); }
        const nx = dx / d, ny = dy / d; const pen = rr - d;
        const wsum = a.invMass + b.invMass; const ca = pen * (a.invMass / wsum) * 0.9, cb = pen * (b.invMass / wsum) * 0.9;
        a.x -= nx * ca; a.y -= ny * ca; b.x += nx * cb; b.y += ny * cb;
        if (!a.landed && it === 0) { a.landed = true; this.onLand && this.onLand(a); }
        if (!b.landed && it === 0) { b.landed = true; this.onLand && this.onLand(b); }
      }
      // walls
      for (const b of bs) {
        if (b.held) continue;
        if (b.x - b.r < this.left) b.x = this.left + b.r;
        if (b.x + b.r > this.right) b.x = this.right - b.r;
        if (b.y + b.r > this.floor) { b.y = this.floor - b.r; if (!b.landed) { b.landed = true; this.onLand && this.onLand(b); } }
        if (b.y - b.r < this.ceil) { b.y = this.ceil + b.r; if (b.vy < 0) b.vy = 0; }
      }
    }
    // velocity update from positions
    for (const b of bs) {
      if (b.held) continue;
      const nvx = (b.x - b.px) / h, nvy = (b.y - b.py) / h;
      // velocity gained from overlap correction is capped so merges/landings push neighbours gently instead of launching them
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > this.maxPush) {
        // fast body (falling): it may be stopped completely, but can only rebound along its path by maxBounce
        const ux = b.vx / sp, uy = b.vy / sp;
        let par = nvx * ux + nvy * uy; let perx = nvx - par * ux, pery = nvy - par * uy; const pm = Math.hypot(perx, pery);
        if (par < -this.maxBounce) par = -this.maxBounce; if (par > sp) par = sp;
        if (pm > this.maxPush) { perx *= this.maxPush / pm; pery *= this.maxPush / pm; }
        b.vx = par * ux + perx; b.vy = par * uy + pery;
      } else {
        // slow/resting body: overlap corrections (merge growth, landings) may only nudge it
        let dvx = nvx - b.vx, dvy = nvy - b.vy; const dm = Math.hypot(dvx, dvy);
        if (dm > this.maxPush) { dvx *= this.maxPush / dm; dvy *= this.maxPush / dm; }
        b.vx += dvx; b.vy += dvy;
      }
    }
    // contact velocity response (bounce + friction + spin)
    for (const [a, b] of contacts) {
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy); const rr = a.r + b.r;
      if (d > rr + 0.02 || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy; const vn = rvx * nx + rvy * ny;
      const wsum = a.invMass + b.invMass;
      if (vn < -0.8) {
        const j = -(1 + this.restitution) * vn / wsum;
        if (!a.held) { a.vx -= j * a.invMass * nx; a.vy -= j * a.invMass * ny; }
        if (!b.held) { b.vx += j * b.invMass * nx; b.vy += j * b.invMass * ny; }
      }
      // tangential friction
      const tx = -ny, ty = nx; const vt = rvx * tx + rvy * ty;
      const jt = -vt * this.friction / wsum;
      if (!a.held) { a.vx -= jt * a.invMass * tx; a.vy -= jt * a.invMass * ty; a.av += (vt / a.r) * 0.08; }
      if (!b.held) { b.vx += jt * b.invMass * tx; b.vy += jt * b.invMass * ty; b.av -= (vt / b.r) * 0.08; }
      if (a.level === b.level && !a.held && !b.held && this.onContact) this.onContact(a, b);
    }
    // wall velocity response
    for (const b of bs) {
      if (b.held) continue;
      if (b.y + b.r >= this.floor - 1e-4) { if (b.vy > 0) b.vy = -b.vy * this.restitution; b.vx *= (1 - this.friction * 0.5); b.av = b.vx / b.r * 0.9; }
      if (b.x - b.r <= this.left + 1e-4 && b.vx < 0) { b.vx = -b.vx * this.restitution; b.av += b.vy / b.r * 0.2; }
      if (b.x + b.r >= this.right - 1e-4 && b.vx > 0) { b.vx = -b.vx * this.restitution; b.av -= b.vy / b.r * 0.2; }
      b.av *= 0.985; b.angle += b.av * h;
      // clamp crazy speeds
      const sp = Math.hypot(b.vx, b.vy); if (sp > this.maxSpeed) { b.vx *= this.maxSpeed / sp; b.vy *= this.maxSpeed / sp; }
    }
  }

  // explosive impulse for "shake"
  impulse(fx, fy, jitter = 0) {
    for (const b of this.bodies) {
      if (b.held) continue;
      b.vx += fx + (Math.random() - 0.5) * jitter; b.vy += fy + (Math.random() - 0.5) * jitter;
      b.av += (Math.random() - 0.5) * 6;
    }
  }
}
// ===== i18n.js =====
// ko / en / ja
const T = {
  title:          ['캔디 머지 2048', 'Candy Merge 2048', 'キャンディマージ 2048'],
  tagline:        ['같은 캔디를 합쳐 수박 캔디를 만들어 보세요!', 'Merge matching candies and make the Watermelon Candy!', '同じキャンディを合わせてスイカを作ろう！'],
  play:           ['플레이', 'PLAY', 'プレイ'],
  score:          ['점수', 'SCORE', 'スコア'],
  best:           ['최고', 'BEST', 'ベスト'],
  next:           ['다음', 'NEXT', 'つぎ'],
  autofire:       ['자동발사', 'AUTO', '自動発射'],
  on: ['ON','ON','ON'], off: ['OFF','OFF','OFF'],
  result:         ['결과', 'RESULT', '結果'],
  new_record:     ['NEW', 'NEW', 'NEW'],
  retry:          ['다시하기', 'PLAY AGAIN', 'もう一度'],
  resume:         ['계속하기', 'RESUME', 'つづける'],
  restart:        ['처음부터', 'RESTART', 'はじめから'],
  menu:           ['메뉴', 'MENU', 'メニュー'],
  sound:          ['사운드', 'SOUND', 'サウンド'],
  vibration:      ['진동', 'VIBRATION', 'バイブ'],
  language:       ['언어', 'LANGUAGE', '言語'],
  last_chance:    ['마지막 기회', 'LAST CHANCE', 'ラストチャンス'],
  last_chance_desc: ['범위를 선택해 캔디를 제거하고<br>이어서 플레이하세요!', 'Pick an area to clear candies<br>and keep playing!', '範囲を選んでキャンディを消し<br>続けてプレイ！'],
  use_gems:       ['{0} 사용', 'USE {0}', '{0} 使う'],
  free_continue:  ['무료 이어하기', 'FREE CONTINUE', '無料で続ける'],
  ad_continue:    ['광고 보고 이어하기', 'WATCH AD · CONTINUE', '広告を見て続ける'],
  ad_gems:        ['광고 보고', 'WATCH AD', '広告を見て'],
  ad_limit:       ['오늘 광고 보상을 모두 받았어요 ({0}/{1})', 'Daily ad rewards used ({0}/{1})', '今日の広告報酬は受け取り済み ({0}/{1})'],
  ad_unavailable: ['지금은 볼 수 있는 광고가 없어요', 'No ad available right now', '今は見られる広告がありません'],
  ad_not_finished:['광고를 끝까지 봐야 보상을 받아요', 'Finish the ad to get the reward', '最後まで見ると報酬がもらえます'],
  select_remove_area: ['제거할 범위를 선택하세요', 'Select the area to remove', '消す範囲を選んでください'],
  pick_one:       ['제거할 캔디를 탭하세요', 'Tap a candy to remove', '消すキャンディをタップ'],
  time_reward:    ['시간 보상', 'TIME REWARD', '時間報酬'],
  time_reward_desc: ['{0}분마다 보상 상자가 열려요!', 'A chest opens every {0} min!', '{0}分ごとに宝箱が開く！'],
  confirm: ['확인','OK','OK'], cancel: ['취소','CANCEL','キャンセル'],
  shop:           ['보석 얻기', 'GET GEMS', 'ジェムを集める'],
  gems:           ['보석', 'GEMS', 'ジェム'],
  not_enough_gems:['보석이 부족합니다', 'Not enough gems', 'ジェムが足りません'],
  ranking:        ['기록', 'RECORDS', '記録'],
  recent_records: ['최근 기록', 'Recent games', '最近の記録'],
  weekly_best:    ['이번 주 최고', 'This week\'s best', '今週のベスト'],
  no_records:     ['기록이 없습니다', 'No records yet', '記録がありません'],
  share:          ['공유', 'SHARE', 'シェア'],
  share_text:     ['캔디 머지 2048에서 {0}점을 기록했어요! 도전해 보세요 → ', 'I scored {0} in Candy Merge 2048! Can you beat it? → ', 'キャンディマージ2048で{0}点！挑戦してみて → '],
  copied:         ['링크를 복사했어요', 'Link copied', 'リンクをコピーしました'],
  daily_bonus:    ['일일 보너스! 보석 +{0}', 'Daily bonus! +{0} gems', 'デイリーボーナス！ジェム+{0}'],
  discovered:     ['새로운 캔디 발견! +{0}', 'New candy discovered! +{0}', '新しいキャンディ発見！+{0}'],
  watermelon_bonus:['수박 보너스!', 'WATERMELON BONUS!', 'スイカボーナス！'],
  collection:     ['컬렉션', 'COLLECTION', 'コレクション'],
  shake:          ['흔들기', 'SHAKE', 'シェイク'],
  remove_one:     ['하나 제거', 'REMOVE', 'ひとつ消す'],
  free:           ['무료', 'FREE', '無料'],
  how_to:         ['조작법', 'HOW TO PLAY', '遊び方'],
  how_to_desc:    ['좌우로 드래그해 위치를 정하고 손을 떼면 캔디가 떨어져요.<br>같은 캔디끼리 닿으면 더 큰 캔디로 합쳐지고, 수박 캔디 2개를 합치면 보너스!<br>캔디가 빨간 선 위에 머물면 게임 오버.<br>PC에서는 ← → 키로 이동, 스페이스바로 떨어뜨릴 수 있어요.',
                   'Drag to aim, release to drop.<br>Two matching candies merge into a bigger one — merge two Watermelon Candies for a bonus!<br>If candies stay above the red line, it\'s game over.<br>On PC you can also use ← → to move and Space to drop.',
                   'ドラッグで位置を決めて離すと落下。<br>同じキャンディ同士がくっつくと大きくなり、<br>スイカ2個で大ボーナス！<br>赤い線の上に留まるとゲームオーバー。<br>PCでは ← → キーで移動、スペースで落とせます。'],
  gem_bonus_end:  ['보석 +{0}', 'Gems +{0}', 'ジェム +{0}'],
  settings:       ['설정', 'SETTINGS', '設定'],
  reset_data:     ['데이터 초기화', 'RESET DATA', 'データ初期化'],
  reset_confirm:  ['모든 기록과 보석이 삭제됩니다. 계속할까요?', 'All records and gems will be erased. Continue?', 'すべての記録とジェムが消えます。続けますか？'],
  back_home:      ['KOGAMES 홈', 'KOGAMES Home', 'KOGAMESホーム'],
  earn_gems_hint: ['보석은 광고 시청, 플레이 종료 보상, 새 캔디 발견, 수박 합치기, 일일 보너스, 시간 보상으로 모을 수 있어요.', 'Earn gems by watching ads, game rewards, new candies, watermelon merges, daily bonus and the time chest.', 'ジェムは広告視聴・プレイ報酬・新キャンディ発見・スイカ合体・デイリー・時間報酬で貯まります。'],
  candy_names: [
    ['블루베리 캔디','체리 캔디','포도 캔디','레몬 캔디','오렌지 캔디','청사과 캔디','복숭아 캔디','코코넛 캔디','파인애플 캔디','멜론 캔디','수박 캔디'],
    ['Blueberry','Cherry','Grape','Lemon','Orange','Apple','Peach','Coconut','Pineapple','Melon','Watermelon'],
    ['ブルーベリー','チェリー','ぶどう','レモン','オレンジ','りんご','もも','ココナッツ','パイナップル','メロン','スイカ'],
  ],
};

const LANGS = ['ko', 'en', 'ja'];
const LANG_NAMES = { ko: '한국어', en: 'English', ja: '日本語' };
let cur = 1;

function initLang(saved) {
  if (saved && LANGS.includes(saved)) { cur = LANGS.indexOf(saved); return; }
  const nav = (navigator.languages || [navigator.language || 'en']).map(s => String(s).slice(0, 2).toLowerCase());
  for (const c of nav) { if (LANGS.includes(c)) { cur = LANGS.indexOf(c); return; } }
  cur = 1;
}
function setLang(code) { cur = Math.max(0, LANGS.indexOf(code)); document.documentElement.lang = code; }
function lang() { return LANGS[cur]; }
function t(key, ...args) {
  const v = T[key]; if (!v) return key;
  let s = v[cur]; args.forEach((a, i) => { s = s.replace(new RegExp('\\{' + i + '\\}', 'g'), a); });
  return s;
}
function candyName(level) { return T.candy_names[cur][level]; }
// ===== save.js =====
// Local-only persistence: localStorage with cookie fallback. No server, no DB.
const KEY = 'candymerge_save_v1';
const DEFAULT = () => ({
  gems: 100, best: 0, discovered: 1, sound: true, vibration: true, lang: null, autoFire: false,
  lastTimeReward: 0, lastDaily: '', games: 0, merges: 0, watermelons: 0,
  records: [],            // [{score, date, merges}] most recent first (max 10)
  weekKey: '', weekBest: 0,
  adDay: '', adCount: 0,     // rewarded-ad gem claims today
});

function readRaw() {
  try { const v = localStorage.getItem(KEY); if (v) return v; } catch (e) {}
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + KEY + '=([^;]*)'));
    if (m) return decodeURIComponent(m[1]);
  } catch (e) {}
  return null;
}
function writeRaw(v) {
  let ok = false;
  try { localStorage.setItem(KEY, v); ok = true; } catch (e) {}
  try { document.cookie = KEY + '=' + encodeURIComponent(v) + '; max-age=31536000; path=/; SameSite=Lax'; } catch (e) {}
  return ok;
}

const Save = {
  d: DEFAULT(),
  load() {
    const raw = readRaw();
    if (raw) { try { this.d = Object.assign(DEFAULT(), JSON.parse(raw)); } catch (e) { this.d = DEFAULT(); } }
    this.checkWeek();
    return this.d;
  },
  save() { writeRaw(JSON.stringify(this.d)); },
  reset() { this.d = DEFAULT(); this.save(); try { localStorage.removeItem(KEY); } catch (e) {} },

  addGems(n) { this.d.gems = Math.max(0, this.d.gems + n); this.save(); this.onGems && this.onGems(this.d.gems); },
  spendGems(n) { if (this.d.gems < n) return false; this.d.gems -= n; this.save(); this.onGems && this.onGems(this.d.gems); return true; },
  isDiscovered(l) { return (this.d.discovered & (1 << l)) !== 0; },
  discover(l) { if (this.isDiscovered(l)) return false; this.d.discovered |= (1 << l); this.save(); return true; },

  weekKey() { const n = new Date(); const diff = (n.getDay() + 6) % 7; const m = new Date(n.getFullYear(), n.getMonth(), n.getDate() - diff); return m.toISOString().slice(0, 10); },
  checkWeek() { const k = this.weekKey(); if (this.d.weekKey !== k) { this.d.weekKey = k; this.d.weekBest = 0; this.save(); } },
  addRecord(score, merges) {
    this.checkWeek();
    const n = new Date();
    const date = `${n.getMonth() + 1}/${n.getDate()} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    this.d.records.unshift({ score, date, merges });
    if (this.d.records.length > 10) this.d.records.length = 10;
    if (score > this.d.weekBest) this.d.weekBest = score;
    if (score > this.d.best) this.d.best = score;
    this.save();
  },

  timeRewardLeftMs(intervalMin) {
    const next = (this.d.lastTimeReward || 0) + intervalMin * 60000;
    return Math.max(0, next - Date.now());
  },
  claimTimeReward() { this.d.lastTimeReward = Date.now(); this.save(); },
  tryDaily() { const today = new Date().toISOString().slice(0, 10); if (this.d.lastDaily === today) return false; this.d.lastDaily = today; this.save(); return true; },
};
// ===== audio.js =====
// Procedural WebAudio SFX (no audio files needed) + haptics.
const Audio = {
  ctx: null, enabled: true, vibrate: true, master: null,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
    } catch (e) {}
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.2, vol = 0.5, attack = 0.005, decay = null, delay = 0 }) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur = 0.3, vol = 0.4, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const s = c.createBufferSource(); s.buffer = buf; const g = c.createGain(); g.gain.value = vol;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  pop(level) { const base = 760 - level * 42; this.tone({ type: 'sine', f0: base, f1: base * 1.8, dur: 0.16, vol: 0.45 }); this.tone({ type: 'triangle', f0: base * 2, f1: base * 1.2, dur: 0.12, vol: 0.15, delay: 0.02 }); },
  drop() { this.tone({ type: 'sine', f0: 260, f1: 330, dur: 0.1, vol: 0.25 }); },
  click() { this.tone({ type: 'square', f0: 1100, dur: 0.05, vol: 0.08 }); },
  coin() { this.tone({ type: 'sine', f0: 1046, dur: 0.25, vol: 0.3 }); this.tone({ type: 'sine', f0: 1568, dur: 0.35, vol: 0.3, delay: 0.08 }); },
  fail() { this.tone({ type: 'sawtooth', f0: 320, f1: 140, dur: 0.7, vol: 0.25 }); },
  big() { [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.8, vol: 0.25, delay: i * 0.07 })); this.noise(0.5, 0.25); },
  boom() { this.noise(0.5, 0.5); this.tone({ type: 'sine', f0: 120, f1: 40, dur: 0.5, vol: 0.5 }); },
  haptic(ms) { if (!this.vibrate) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} },
};
// ===== ads.js =====
// Google H5 Games Ads (Ad Placement API) — rewarded + interstitial. No SDK beyond adsbygoogle.js.
// Everything degrades gracefully: with an ad blocker or before AdSense approval, reward() resolves 'unavailable'
// and interstitial() resolves immediately, so the game never hangs on ads.
const Ads = {
  client: '', loaded: false, apiReady: false, testing: false, busy: false, onPause: null, onResume: null,
  init(client, { sound = true, test = false, frequencyHint = '60s' } = {}) {
    this.client = client; this.testing = test;
    if (document.querySelector('script[data-h5-ads]')) return;
    window.adsbygoogle = window.adsbygoogle || [];
    if (!window.adBreak) { window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); }; }
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous'; s.dataset.h5Ads = '1';
    s.dataset.adFrequencyHint = frequencyHint;
    if (test) s.dataset.adbreakTest = 'on';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
    s.onload = () => { this.loaded = true; };
    document.head.appendChild(s);
    // onReady only fires once the Ad Placement API is live for this AdSense account/site; until then every placement is skipped instantly.
    window.adConfig({ preloadAdBreaks: 'on', sound: sound ? 'on' : 'off', onReady: () => { this.loaded = true; this.apiReady = true; } });
  },
  setSound(on) { try { window.adConfig && window.adConfig({ sound: on ? 'on' : 'off' }); } catch (e) {} },
  available() { return this.apiReady && !!window.adBreak; },

  // Rewarded ad. Resolves 'viewed' | 'dismissed' | 'unavailable'.
  reward(name) {
    return new Promise((resolve) => {
      if (this.busy || !this.available()) { resolve('unavailable'); return; }
      this.busy = true; let offered = false, done = false, paused = false;
      const finish = (st) => { if (done) return; done = true; this.busy = false; clearTimeout(tm); if (paused) { paused = false; this.onResume && this.onResume(); } resolve(st); };
      const tm = setTimeout(() => { if (!offered) finish('unavailable'); }, 6000);
      try {
        window.adBreak({
          type: 'reward', name,
          beforeReward: (showAdFn) => { offered = true; clearTimeout(tm); try { showAdFn(); } catch (e) { finish('unavailable'); } },
          beforeAd: () => { paused = true; this.onPause && this.onPause(); },
          afterAd: () => { if (paused) { paused = false; this.onResume && this.onResume(); } },
          adDismissed: () => finish('dismissed'),
          adViewed: () => finish('viewed'),
          adBreakDone: (info) => { const st = info && info.breakStatus; if (!offered) finish('unavailable'); else finish(st === 'viewed' ? 'viewed' : 'dismissed'); },
        });
      } catch (e) { finish('unavailable'); }
    });
  },

  // Interstitial ("next" placement). Always resolves; frequency is managed by Google.
  interstitial(name) {
    return new Promise((resolve) => {
      if (this.busy || !this.available()) { resolve(false); return; }
      this.busy = true; let shown = false, done = false, paused = false;
      const finish = () => { if (done) return; done = true; this.busy = false; clearTimeout(tm); if (paused) { paused = false; this.onResume && this.onResume(); } resolve(shown); };
      const tm = setTimeout(finish, shown ? 60000 : 2500);
      try {
        window.adBreak({
          type: 'next', name,
          beforeAd: () => { shown = true; paused = true; clearTimeout(tm); this.onPause && this.onPause(); },
          afterAd: () => { if (paused) { paused = false; this.onResume && this.onResume(); } },
          adBreakDone: () => finish(),
        });
      } catch (e) { finish(); }
    });
  },
};
// ===== main.js =====
// ===================== Candy Merge 2048 — main =====================
const CFG = {
  candies: [ // radius (world units), merge score (triangular numbers), tint
    { r: 0.26, s: 1,  c: '#3D6BFF' }, { r: 0.36, s: 3,  c: '#FF3D6E' }, { r: 0.50, s: 6,  c: '#A85BFF' }, { r: 0.57, s: 10, c: '#FFE033' },
    { r: 0.70, s: 15, c: '#FF8C1A' }, { r: 0.86, s: 21, c: '#8FE03A' }, { r: 0.95, s: 28, c: '#FF9A8A' }, { r: 1.18, s: 36, c: '#C27A3C' },
    { r: 1.36, s: 45, c: '#FFB31A' }, { r: 1.56, s: 55, c: '#4FDDAA' }, { r: 1.72, s: 66, c: '#2FB857' },
  ],
  maxLevel: 10, scoreMul: 2, wmBonus: 100, wmGems: 10, spawnMax: 4,
  jar: { left: -3.6, right: 3.6, top: 0, floor: 9.0, dropY: -0.8, deadY: 0.4, grace: 1.2 },
  keySpeed: 7.5,            // world units per second for keyboard aiming
  physics: { gravity: 26, restitution: 0.14, friction: 0.3, maxPush: 11, maxBounce: 7, maxSpeed: 26 },
  mergePop: 4.5,            // outward nudge (u/s) given to neighbours when candies merge
  dropCooldown: 0.55, autoFireInterval: 1.4,
  shakeCost: 30, shakeFree: 1, shakeForce: 8, removeCost: 20, removeMax: 3,
  continueCosts: [100, 200, 300, 500, 800], freeContinues: 1, continueRadius: 1.6, invincible: 3,
  timeRewardMin: 30, timeRewardGems: 10, dailyGems: 10, newRecordGems: 5, discoverGems: 3,
  endBase: 2, endPerPts: 1500, endCap: 10,
  ads: { client: 'ca-pub-1318477289708440', gems: 20, gemsPerDay: 5, interstitialMinPlay: 20 },
};

const SPR = 512 / 392; // sprite px radius of the puck face vs. canvas half-size
const $ = (s) => document.querySelector(s);
const stage = $('#stage'), canvas = $('#game'), ctx = canvas.getContext('2d');

// ---------------- assets ----------------
const Assets = { candy: [], ready: false };
function loadAssets() {
  const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(im); im.src = src; });
  const ps = [];
  for (let i = 1; i <= 11; i++) ps.push(load(`assets/candy/${String(i).padStart(2, '0')}.webp`).then(im => Assets.candy[i - 1] = im));
  ps.push(load('assets/bg.jpg').then(im => Assets.bg = im));
  return Promise.all(ps).then(() => { Assets.ready = true; });
}

// ---------------- view / layout ----------------
const View = { w: 0, h: 0, dpr: 1, scale: 1, ox: 0, oy: 0 };
function resize() {
  const r = stage.getBoundingClientRect();
  View.dpr = Math.min(2.5, window.devicePixelRatio || 1);
  View.w = r.width; View.h = r.height;
  canvas.width = Math.round(r.width * View.dpr); canvas.height = Math.round(r.height * View.dpr);
  document.documentElement.style.setProperty('--s', (r.width / 1080).toFixed(4));
  // world: 8.4 units wide, ~14.2 tall (HUD rows above jar, evo bar below)
  const WU = 8.4, HU = 14.2;
  View.scale = Math.min(r.width / WU, r.height / HU);
  const extraH = r.height / View.scale - HU;
  View.ox = r.width / 2;                                   // x=0 at center
  View.oy = (3.9 + extraH * 0.5) * View.scale;             // world y=0 (jar top) position in px
}
const W2S = (x, y) => [View.ox + x * View.scale, View.oy + y * View.scale];
const S2W = (px, py) => [(px - View.ox) / View.scale, (py - View.oy) / View.scale];
window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------------- particles & popups ----------------
const FX = { parts: [], pops: [], shake: 0, shakeT: 0 };
function burst(x, y, lv, tint, scale = 1) {
  const cols = [tint, '#ffffff', '#ffd93d', '#6fc3ff', '#ff6fb5', '#7cf2a2'];
  const n = Math.round((14 + lv * 3) * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = (3 + Math.random() * 6) * scale;
    FX.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, life: 0.7 + Math.random() * 0.5, t: 0, size: (0.1 + Math.random() * 0.12) * scale, col: cols[(Math.random() * cols.length) | 0], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, kind: 'sq' });
  }
  for (let i = 0; i < Math.round(8 * scale); i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
    FX.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.3, t: 0, size: (0.14 + Math.random() * 0.16) * scale, col: Math.random() < 0.5 ? '#fff' : '#fff3a0', rot: 0, vr: 0, kind: 'star' });
  }
  FX.parts.push({ x, y, vx: 0, vy: 0, life: 0.35, t: 0, size: 0.9 * scale, col: 'rgba(255,255,255,0.9)', kind: 'ring' });
}
function scorePop(x, y, text, col = '#fff', size = 1) { FX.pops.push({ x, y, text, col, size, t: 0, life: 0.95 }); }
function shakeCam(a, d) { FX.shake = a; FX.shakeT = d; }

// ---------------- game state ----------------
const G = {
  state: 'title', world: null, score: 0, next: 0, held: null, aimX: 0, dragging: false, pointerDown: false,
  dropCooldownUntil: 0, autoFireAt: 0, continueCount: 0, adContinues: 0, shakes: 0, removes: 0, merges: 0,
  isNewRecord: false, endGems: 0, invincibleUntil: 0, time: 0, removeRadius: 0, onRemove: null, removePos: [0, 0],
  pickTarget: null, tickDanger: 0, lastFrame: 0, paused: false,
};

function newWorld() {
  const j = CFG.jar;
  const w = new World({ left: j.left, right: j.right, floor: j.floor, ceil: j.dropY - 1.2, ...CFG.physics });
  w.onContact = (a, b) => queueMerge(a, b);
  w.onLand = (b) => {};
  return w;
}

function rollNext() {
  const wts = [1.0, 1.0, 0.9, 0.7, 0.5]; let tot = 0; for (let i = 0; i <= CFG.spawnMax; i++) tot += wts[i];
  let r = Math.random() * tot; for (let i = 0; i <= CFG.spawnMax; i++) { r -= wts[i]; if (r <= 0) return i; } return 0;
}

function startGame() {
  G.world = newWorld(); G.score = 0; G.continueCount = 0; G.adContinues = 0; G.shakes = 0; G.removes = 0; G.merges = 0;
  G.isNewRecord = false; G.endGems = 0; G.invincibleUntil = 0; G.held = null; G.aimX = 0; G.time = 0; FX.parts.length = 0; FX.pops.length = 0;
  G.next = rollNext(); updateNext();
  setState('playing');
  Save.d.games++; Save.save();
  spawnHeld();
  UI.setScore(0); UI.refresh();
}

function setState(s) { G.state = s; UI.onState(s); }

function clampX(x, r) { return Math.min(CFG.jar.right - r - 0.02, Math.max(CFG.jar.left + r + 0.02, x)); }

function spawnHeld() {
  if (G.state !== 'playing') return;
  const lv = G.next; G.next = rollNext(); updateNext();
  const r = CFG.candies[lv].r;
  const b = new Body(clampX(G.aimX, r), CFG.jar.dropY, r, lv);
  b.held = true; b.scale = 0.3; G.held = b; G.world.add(b);
  G.autoFireAt = G.time + CFG.autoFireInterval;
}
function updateNext() { UI.setNext(G.next); }

function dropHeld() {
  const b = G.held; if (!b || G.state !== 'playing') return;
  G.held = null; b.held = false; b.vy = 0.5; Audio.drop();
  G.dropCooldownUntil = G.time + CFG.dropCooldown; G.dropped = b;
}

// merges are processed after the physics step
const mergeQueue = [];
function queueMerge(a, b) {
  if (a.dead || b.dead || a.merging || b.merging) return;
  if (a.held || b.held) return;
  if (!a.landed && !b.landed) return;
  a.merging = b.merging = true; mergeQueue.push([a, b]);
}
function processMerges() {
  while (mergeQueue.length) {
    const [a, b] = mergeQueue.shift();
    if (a.dead || b.dead) { a.merging = b.merging = false; continue; }
    const lv = a.level; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const vx = (a.vx + b.vx) / 2 * 0.3, vy = (a.vy + b.vy) / 2 * 0.3;
    G.world.remove(a); G.world.remove(b); G.merges++; Save.d.merges++;
    if (lv >= CFG.maxLevel) {
      const pts = (CFG.candies[lv].s + CFG.wmBonus) * CFG.scoreMul;
      addScore(pts); burst(mx, my, 10, '#ff3b5c', 2.4); Audio.big(); Audio.haptic([60, 40, 90]); shakeCam(0.25, 0.5);
      scorePop(mx, my - 0.4, '+' + pts, '#fff6a0', 1.6); scorePop(mx, my + 0.5, t('watermelon_bonus'), '#ffe066', 1.1);
      Save.addGems(CFG.wmGems); UI.toast('+' + CFG.wmGems + ' ' + t('gems')); Save.d.watermelons++;
      continue;
    }
    const nl = lv + 1; const r = CFG.candies[nl].r;
    const n = new Body(mx, my, r, nl); n.landed = true; n.vx = vx; n.vy = vy; n.scale = 0.55; n.r = Math.max(a.r, b.r); n.tr = r; G.world.add(n);  // physics radius grows in so neighbours get nudged, not launched
    // merge "pop": neighbours get a gentle shove away from the merge point (falls off with distance)
    const range = r + 1.0;
    for (const o of G.world.bodies) { if (o === n || o.held) continue; const dx = o.x - mx, dy = o.y - my; const d = Math.hypot(dx, dy); if (d > range + o.r || d < 1e-4) continue; const k = CFG.mergePop * (1 - Math.max(0, d - r) / (range - r + o.r)) / Math.max(0.6, o.mass / n.mass); o.vx += dx / d * k; o.vy += dy / d * k - k * 0.35; }
    const pts = CFG.candies[nl].s * CFG.scoreMul; addScore(pts);
    burst(mx, my, nl, CFG.candies[nl].c, 1 + nl * 0.12); scorePop(mx, my - r * 0.6, '+' + pts, '#fff', 0.9 + nl * 0.07);
    Audio.pop(nl); if (nl >= 6) Audio.haptic(nl >= 9 ? 50 : 20); if (nl >= 8) shakeCam(0.06 + nl * 0.015, 0.25);
    if (nl === CFG.maxLevel) { Save.d.watermelons++; }
    if (Save.discover(nl)) { Save.addGems(CFG.discoverGems); UI.refreshEvo(nl); UI.toast(t('discovered', CFG.discoverGems)); }
  }
}
function addScore(v) {
  G.score += v; UI.setScore(G.score);
  if (G.score > Save.d.best) { if (!G.isNewRecord && Save.d.best > 0) G.isNewRecord = true; Save.d.best = G.score; UI.setBest(G.score); }
}

// ---------------- dead line / game over ----------------
function checkDeadLine(dt) {
  let danger = false;
  if (G.time < G.invincibleUntil) { for (const b of G.world.bodies) b.aboveTime = 0; G.tickDanger = 0; return; }
  for (const b of G.world.bodies) {
    if (b.held) continue;
    const above = b.y - b.r < CFG.jar.deadY; const fast = (b.vx * b.vx + b.vy * b.vy) > 9;   // flying candies (just dropped / bounced) don't count
    if (above && b.landed && !fast) { b.aboveTime += dt; danger = true; } else if (!above) b.aboveTime = Math.max(0, b.aboveTime - dt * 2);
    if (b.aboveTime >= CFG.jar.grace) { triggerGameOver(); return; }
  }
  G.tickDanger = danger ? Math.min(1, G.tickDanger + dt * 6) : Math.max(0, G.tickDanger - dt * 4);
  if (danger && Math.floor(G.time * 4) !== Math.floor((G.time - dt) * 4)) Audio.haptic(15);
}
function triggerGameOver() {
  if (G.state !== 'playing') return;
  if (G.held) { G.world.remove(G.held); G.held = null; }
  Audio.fail(); Audio.haptic([80, 60, 120]); setState('lastchance'); UI.showLastChance();
}
function continueCost() { return CFG.continueCosts[Math.min(G.continueCount, CFG.continueCosts.length - 1)]; }
function continueGame(free) {
  if (free) G.adContinues++; G.continueCount++;
  for (const b of G.world.bodies) b.aboveTime = 0;
  beginRemoveSelect(CFG.continueRadius, (x, y) => { removeInRadius(x, y, CFG.continueRadius); G.invincibleUntil = G.time + CFG.invincible; setState('playing'); spawnHeld(); });
}
function finishGame() {
  setState('result');
  Save.addRecord(G.score, G.merges);
  let gems = Math.min(CFG.endCap, CFG.endBase + Math.floor(G.score / CFG.endPerPts));
  if (G.isNewRecord) gems += CFG.newRecordGems;
  G.endGems = gems; Save.addGems(gems); Save.save();
  if (G.time >= CFG.ads.interstitialMinPlay) Ads.interstitial('game_over').then(() => UI.showResult()); else UI.showResult();
}

// ---------------- remove area / pick one / shake ----------------
function beginRemoveSelect(radius, cb) {
  G.removeRadius = radius; G.onRemove = cb; G.removePos = [0, CFG.jar.top + radius];
  setState('remove'); UI.showHint(t('select_remove_area'), false);
}
function removeInRadius(x, y, r) {
  for (const b of [...G.world.bodies]) {
    if (b.held) continue;
    if (Math.hypot(b.x - x, b.y - y) <= r + b.r * 0.5) { burst(b.x, b.y, b.level, CFG.candies[b.level].c, 0.8); G.world.remove(b); }
  }
  burst(x, y, 6, '#ffffff', 1.6); Audio.boom(); Audio.haptic(60); shakeCam(0.18, 0.35);
  for (const b of G.world.bodies) b.aboveTime = 0;
}
function inRemove(b) { return Math.hypot(b.x - G.removePos[0], b.y - G.removePos[1]) <= G.removeRadius + b.r * 0.5; }
function cancelModes() {
  if (G.state === 'remove' && G.onRemove && G.continuePending) return; // continue selection can't be cancelled (handled by UI)
  if (G.state === 'remove' || G.state === 'pick') { G.onRemove = null; G.pickTarget = null; setState('playing'); UI.hideHint(); }
}
function shakeCostNow() { return G.shakes < CFG.shakeFree ? 0 : CFG.shakeCost; }
function useShake() {
  if (G.state !== 'playing') return;
  const cost = shakeCostNow();
  if (cost > 0 && !Save.spendGems(cost)) { UI.toast(t('not_enough_gems')); UI.showShop(); return; }
  G.shakes++; UI.refresh(); shakeCam(0.12, 0.5); Audio.haptic(40); Audio.noise(0.3, 0.3);
  let i = 0; const iv = setInterval(() => { const dir = i % 2 ? -1 : 1; G.world.impulse(dir * CFG.shakeForce * 0.45, -CFG.shakeForce * 0.35, 2.5); if (++i >= 6) clearInterval(iv); }, 80);
}
function useRemoveOne() {
  if (G.state !== 'playing' || G.removes >= CFG.removeMax) return;
  if (Save.d.gems < CFG.removeCost) { UI.toast(t('not_enough_gems')); UI.showShop(); return; }
  setState('pick'); UI.showHint(t('pick_one'), true);
}
function pickAt(x, y) {
  let best = null, bd = 1e9;
  for (const b of G.world.bodies) { if (b.held) continue; const d = Math.hypot(b.x - x, b.y - y); if (d <= b.r + 0.15 && d < bd) { bd = d; best = b; } }
  if (!best) return;
  if (!Save.spendGems(CFG.removeCost)) { UI.toast(t('not_enough_gems')); return; }
  G.removes++; burst(best.x, best.y, best.level, CFG.candies[best.level].c, 1); Audio.pop(best.level); G.world.remove(best);
  for (const b of G.world.bodies) b.aboveTime = 0;
  setState('playing'); UI.hideHint(); UI.refresh();
}

// ---------------- input ----------------
function pointerPos(e) { const r = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return S2W(p.clientX - r.left, p.clientY - r.top); }
function onDown(e) {
  if (e.target !== canvas) return;
  Audio.init(); Audio.resume();
  const [x, y] = pointerPos(e);
  if (G.state === 'playing') {
    if (y < CFG.jar.dropY - 1.6 || y > CFG.jar.floor + 1.2) return;
    G.pointerDown = true; G.dragging = true; G.keyAim = false; G.aimX = x; e.preventDefault();
  } else if (G.state === 'remove' || G.state === 'pick') { G.pointerDown = true; G.removePos = [clampJar(x, y)[0], clampJar(x, y)[1]]; e.preventDefault(); }
}
function onMove(e) {
  if (!G.pointerDown) return;
  const [x, y] = pointerPos(e);
  if (G.state === 'playing') G.aimX = x;
  else if (G.state === 'remove' || G.state === 'pick') G.removePos = clampJar(x, y);
  e.preventDefault();
}
function onUp(e) {
  if (!G.pointerDown) return; G.pointerDown = false;
  if (G.state === 'playing') { G.dragging = false; if (!Save.d.autoFire && G.held) dropHeld(); }
  else if (G.state === 'remove') { const cb = G.onRemove; G.onRemove = null; UI.hideHint(); cb && cb(G.removePos[0], G.removePos[1]); }
  else if (G.state === 'pick') { pickAt(G.removePos[0], G.removePos[1]); }
}
function clampJar(x, y) { return [Math.min(CFG.jar.right, Math.max(CFG.jar.left, x)), Math.min(CFG.jar.floor, Math.max(CFG.jar.top - 0.5, y))]; }
canvas.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
canvas.addEventListener('touchstart', onDown, { passive: false }); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onUp); window.addEventListener('touchcancel', onUp);
// keyboard (desktop): ←/→ or A/D move the held candy, Space/↓/Enter drop it
G.keys = { left: false, right: false }; G.keyAim = false;
function keyDir(e) { const k = e.key; if (k === 'ArrowLeft' || k === 'a' || k === 'A') return 'left'; if (k === 'ArrowRight' || k === 'd' || k === 'D') return 'right'; return null; }
function isDropKey(e) { return e.code === 'Space' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'Enter'; }
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { UI.onBack(); return; }
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (G.paused || UI.popupStack.length) return;
  const dir = keyDir(e);
  if (dir && (G.state === 'playing' || G.state === 'remove' || G.state === 'pick')) { G.keys[dir] = true; G.keyAim = true; if (G.state === 'playing' && document.activeElement && document.activeElement.blur) document.activeElement.blur(); e.preventDefault(); return; }
  if (isDropKey(e)) {
    if (e.repeat) { e.preventDefault(); return; }
    if (G.state === 'playing') { if (G.held && !G.pointerDown) { G.keyAim = true; Audio.init(); Audio.resume(); dropHeld(); } e.preventDefault(); }
    else if (G.state === 'remove') { const cb = G.onRemove; G.onRemove = null; UI.hideHint(); cb && cb(G.removePos[0], G.removePos[1]); e.preventDefault(); }
    else if (G.state === 'pick') { pickAt(G.removePos[0], G.removePos[1]); e.preventDefault(); }
  }
});
window.addEventListener('keyup', (e) => { const dir = keyDir(e); if (dir) { G.keys[dir] = false; e.preventDefault(); } else if (isDropKey(e) && (G.state === 'playing' || G.state === 'remove' || G.state === 'pick')) e.preventDefault(); });
window.addEventListener('blur', () => { G.keys.left = G.keys.right = false; });

// ---------------- loop ----------------
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!G.lastFrame) G.lastFrame = now;
  let dt = Math.min(0.05, (now - G.lastFrame) / 1000); G.lastFrame = now;
  if (G.paused) dt = 0;
  if (dt > 0) update(dt);
  render();
}
function update(dt) {
  G.time += dt;
  const sim = G.state === 'playing' || G.state === 'remove' || G.state === 'pick' || G.state === 'lastchance' || G.state === 'result';
  if (G.world && sim) {
    if (G.state === 'playing' && !G.pointerDown && (G.keys.left || G.keys.right)) { const kv = CFG.keySpeed * dt * ((G.keys.right ? 1 : 0) - (G.keys.left ? 1 : 0)); G.aimX = clampX(G.aimX + kv, G.held ? G.held.r : 0.3); }
    else if ((G.state === 'remove' || G.state === 'pick') && !G.pointerDown && (G.keys.left || G.keys.right)) { const kv = CFG.keySpeed * dt * ((G.keys.right ? 1 : 0) - (G.keys.left ? 1 : 0)); G.removePos = clampJar(G.removePos[0] + kv, G.removePos[1]); }
    if (G.held) { G.held.x = clampX(G.aimX, G.held.r); G.held.y = CFG.jar.dropY; }
    G.world.step(1 / 60); processMerges();
    for (const b of G.world.bodies) if (b.scale < 1) b.scale = Math.min(1, b.scale + dt * 4.5);
  }
  if (G.state === 'playing') {
    // spawn next after cooldown / landing
    if (!G.held && G.time >= G.dropCooldownUntil - 0.3 && (G.time >= G.dropCooldownUntil || (G.dropped && G.dropped.landed))) { G.dropped = null; spawnHeld(); }
    if (Save.d.autoFire && G.held && G.time >= G.autoFireAt) dropHeld();
    checkDeadLine(dt);
  }
  // fx
  for (let i = FX.parts.length - 1; i >= 0; i--) { const p = FX.parts[i]; p.t += dt; if (p.t >= p.life) { FX.parts.splice(i, 1); continue; } if (p.kind !== 'ring') { p.vy += 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; } }
  for (let i = FX.pops.length - 1; i >= 0; i--) { const p = FX.pops[i]; p.t += dt; if (p.t >= p.life) FX.pops.splice(i, 1); }
  if (FX.shakeT > 0) FX.shakeT -= dt;
}

// ---------------- render ----------------
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function render() {
  const dpr = View.dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = View.w, h = View.h;
  // background
  if (Assets.bg && Assets.bg.width) { const s = Math.max(w / Assets.bg.width, h / Assets.bg.height); ctx.drawImage(Assets.bg, (w - Assets.bg.width * s) / 2, (h - Assets.bg.height * s) / 2, Assets.bg.width * s, Assets.bg.height * s); }
  else { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5b2bd6'); g.addColorStop(1, '#ff5bae'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  // camera shake
  let sx = 0, sy = 0; if (FX.shakeT > 0) { const k = FX.shakeT; sx = (Math.random() - 0.5) * FX.shake * View.scale * 2 * k; sy = (Math.random() - 0.5) * FX.shake * View.scale * 2 * k; }
  ctx.save(); ctx.translate(sx, sy);
  const S = View.scale, J = CFG.jar;
  const [jl, jt] = W2S(J.left, J.top), [jr, jb] = W2S(J.right, J.floor);
  const jw = jr - jl, jh = jb - jt;
  // mural (faint candies behind the jar)
  if (Assets.ready) {
    ctx.globalAlpha = 0.16;
    const mur = [[10, -1.4, 3.6, 2.6], [8, 1.6, 4.9, 2.0], [6, 0.4, 6.9, 1.5], [3, -1.9, 1.6, 1.1]];
    for (const [lv, mx, my, sc] of mur) { const im = Assets.candy[lv]; const [px, py] = W2S(mx, my); const d = sc * S; ctx.drawImage(im, px - d / 2, py - d / 2, d, d); }
    ctx.globalAlpha = 1;
  }
  // jar glass
  const pad = 0.16 * S;
  ctx.save();
  rr(jl - pad, jt - pad * 2, jw + pad * 2, jh + pad * 3, 0.5 * S);
  const gg = ctx.createLinearGradient(0, jt, 0, jb); gg.addColorStop(0, 'rgba(255,255,255,0.42)'); gg.addColorStop(1, 'rgba(255,255,255,0.18)');
  ctx.fillStyle = gg; ctx.fill();
  const eg = ctx.createLinearGradient(jl, 0, jr, 0); eg.addColorStop(0, 'rgba(255,255,255,0.75)'); eg.addColorStop(0.1, 'rgba(255,255,255,0)'); eg.addColorStop(0.9, 'rgba(255,255,255,0)'); eg.addColorStop(1, 'rgba(255,255,255,0.75)');
  ctx.fillStyle = eg; ctx.fill();
  ctx.lineWidth = 0.14 * S; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
  ctx.lineWidth = 0.05 * S; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; rr(jl - pad * 0.3, jt - pad * 1.3, jw + pad * 0.6, jh + pad * 1.6, 0.4 * S); ctx.stroke();
  // floor shade
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(jl - pad, jb - 0.22 * S, jw + pad * 2, 0.22 * S + pad);
  ctx.restore();
  // dead line
  if (G.tickDanger > 0 || G.state === 'lastchance') {
    const [dlx, dly] = W2S(J.left, J.deadY); const a = 0.35 + 0.45 * Math.abs(Math.sin(G.time * 10));
    ctx.fillStyle = `rgba(255,60,80,${(G.state === 'lastchance' ? 0.9 : a * G.tickDanger).toFixed(3)})`; ctx.fillRect(dlx, dly - 0.03 * S, jw, 0.06 * S);
  }
  // guide line
  if (G.state === 'playing' && G.held && (G.dragging || Save.d.autoFire || G.keyAim)) {
    const [gx, gy] = W2S(G.held.x, G.held.y + G.held.r); const [, fy] = W2S(0, J.floor);
    ctx.strokeStyle = 'rgba(255,150,30,0.85)'; ctx.lineWidth = 0.05 * S; ctx.setLineDash([0.18 * S, 0.12 * S]); ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, fy); ctx.stroke(); ctx.setLineDash([]);
  }
  // candies
  if (G.world && Assets.ready) {
    const list = G.world.bodies;
    for (const b of list) {
      const im = Assets.candy[b.level]; if (!im || !im.width) continue;
      const [px, py] = W2S(b.x, b.y); const d = b.r * 2 * SPR * S * b.scale; // sprite has margin (candy radius 436 of 512 + glow)
      const dim = (G.state === 'remove' && inRemove(b)) || (G.state === 'pick' && G.pointerDown && Math.hypot(b.x - G.removePos[0], b.y - G.removePos[1]) <= b.r + 0.15);
      ctx.save(); ctx.translate(px, py); ctx.rotate(b.angle); if (dim) ctx.globalAlpha = 0.45;
      if (b.held) { ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 0.2 * S; ctx.shadowOffsetY = 0.12 * S; }
      ctx.drawImage(im, -d / 2, -d / 2, d, d); ctx.restore();
    }
  }
  // remove indicator
  if (G.state === 'remove') {
    const [cx, cy] = W2S(G.removePos[0], G.removePos[1]); const R = G.removeRadius * S;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(G.time * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 0.08 * S; ctx.setLineDash([0.3 * S, 0.18 * S]); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }
  // particles
  for (const p of FX.parts) {
    const k = p.t / p.life; const [px, py] = W2S(p.x, p.y); const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    ctx.save(); ctx.translate(px, py); ctx.globalAlpha = a;
    if (p.kind === 'ring') { ctx.strokeStyle = p.col; ctx.lineWidth = 0.08 * S * (1 - k); ctx.beginPath(); ctx.arc(0, 0, p.size * S * (0.3 + k * 1.2), 0, Math.PI * 2); ctx.stroke(); }
    else if (p.kind === 'star') { ctx.fillStyle = p.col; const r = p.size * S * (1 - k * 0.6); ctx.beginPath(); for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4; const rad = i % 2 ? r * 0.35 : r; ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); } ctx.closePath(); ctx.fill(); }
    else { ctx.rotate(p.rot); ctx.fillStyle = p.col; const s = p.size * S; ctx.fillRect(-s / 2, -s / 2, s, s * 0.7); }
    ctx.restore();
  }
  // score pops
  for (const p of FX.pops) {
    const k = p.t / p.life; const [px, py] = W2S(p.x, p.y - k * 1.1); const a = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4; const sc = 1 + 0.35 * Math.sin(Math.min(1, k * 3) * Math.PI);
    ctx.save(); ctx.translate(px, py); ctx.scale(sc, sc); ctx.globalAlpha = a; ctx.font = `700 ${Math.round(0.42 * S * p.size)}px Fredoka, Nunito, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 0.08 * S; ctx.strokeStyle = 'rgba(60,30,10,0.85)'; ctx.lineJoin = 'round'; ctx.strokeText(p.text, 0, 0); ctx.fillStyle = p.col; ctx.fillText(p.text, 0, 0); ctx.restore();
  }
  ctx.restore();
}

// snapshot of the jar for result / last-chance cards
function snapshot() {
  const c = document.createElement('canvas'); const S = 48; const J = CFG.jar;
  c.width = (J.right - J.left + 0.6) * S; c.height = (J.floor - J.top + 1.6) * S; const x = c.getContext('2d');
  x.fillStyle = '#f7e3b5'; x.fillRect(0, 0, c.width, c.height);
  const tx = (wx) => (wx - J.left + 0.3) * S, ty = (wy) => (wy - J.top + 1.3) * S;
  x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(tx(J.left), ty(J.top), (J.right - J.left) * S, (J.floor - J.top) * S);
  if (G.world) for (const b of G.world.bodies) { const im = Assets.candy[b.level]; if (!im) continue; const d = b.r * 2 * SPR * S; x.save(); x.translate(tx(b.x), ty(b.y)); x.rotate(b.angle); x.drawImage(im, -d / 2, -d / 2, d, d); x.restore(); }
  return c;
}

// ---------------- UI ----------------
const UI = {
  els: {}, popup: null, popupStack: [],
  init() {
    const e = this.els;
    ['hud', 'score', 'best', 'gems', 'shake-cost', 'remove-cost', 'btn-shake', 'btn-remove', 'btn-auto', 'auto-state', 'auto-label', 'next-img', 'next-label', 'hint', 'hint-text', 'hint-cancel', 'evobar', 'title', 't-title', 't-tagline', 'btn-play', 'btn-howto', 'btn-lang', 'title-best', 'popups', 'toast', 'logo-candies', 'home-link', 'btn-records', 'btn-collection', 'btn-share', 'btn-menu', 'btn-shop']
      .forEach(id => e[id] = document.getElementById(id));
    e['btn-play'].onclick = () => { Audio.init(); Audio.resume(); Audio.click(); e.title.hidden = true; e.hud.hidden = false; startGame(); this.maybeDaily(); };
    e['btn-howto'].onclick = () => this.showHowTo();
    e['btn-lang'].onclick = () => { const i = (LANGS.indexOf(lang()) + 1) % LANGS.length; setLang(LANGS[i]); Save.d.lang = LANGS[i]; Save.save(); this.applyTexts(); };
    e['btn-shake'].onclick = () => { Audio.click(); useShake(); };
    e['btn-remove'].onclick = () => { Audio.click(); useRemoveOne(); };
    e['btn-auto'].onclick = () => { Audio.click(); Save.d.autoFire = !Save.d.autoFire; Save.save(); G.autoFireAt = G.time + CFG.autoFireInterval; this.refresh(); };
    e['hint-cancel'].onclick = () => { if (G.state === 'remove' && G.continuePending) return; cancelModes(); };
    e['btn-records'].onclick = () => this.showRecords();
    e['btn-collection'].onclick = () => this.showCollection();
    e['btn-share'].onclick = () => this.share();
    e['btn-menu'].onclick = () => this.showMenu();
    e['btn-shop'].onclick = () => this.showShop();
    e.evobar.onclick = () => this.showCollection();
    for (let i = 0; i < 11; i++) { const im = document.createElement('img'); im.src = `assets/candy/${String(i + 1).padStart(2, '0')}.webp`; const s = 44 + (100 - 44) * i / 10; im.style.width = `calc(${s}px * var(--s))`; im.style.height = im.style.width; im.alt = ''; e.evobar.appendChild(im); }
    [10, 6, 3, 1, 4, 8].forEach((lv, i) => { const im = document.createElement('img'); im.src = `assets/candy/${String(lv + 1).padStart(2, '0')}.webp`; const s = [240, 170, 120, 90, 140, 200][i]; im.style.width = `calc(${s}px * var(--s))`; im.style.height = im.style.width; e['logo-candies'].appendChild(im); });
    Save.onGems = () => this.refresh();
    this.applyTexts(); this.refresh(); this.refreshEvo();
  },
  applyTexts() {
    const e = this.els;
    e['t-title'].textContent = t('title'); e['t-tagline'].textContent = t('tagline'); e['btn-play'].textContent = t('play');
    e['btn-howto'].textContent = t('how_to'); e['btn-lang'].textContent = '🌐 ' + LANG_NAMES[lang()];
    e['auto-label'].textContent = t('autofire'); e['next-label'].textContent = t('next'); e['hint-cancel'].textContent = t('cancel');
    e['home-link'].textContent = t('back_home');
    e['title-best'].textContent = Save.d.best > 0 ? `${t('best')} ${Save.d.best.toLocaleString()}` : '';
    document.title = t('title') + ' — KOGAMES';
    this.refresh();
  },
  refresh() {
    const e = this.els; const d = Save.d;
    e.gems.textContent = d.gems.toLocaleString(); e.best.textContent = d.best.toLocaleString();
    e['btn-auto'].classList.toggle('on', d.autoFire); e['auto-state'].textContent = d.autoFire ? t('on') : t('off');
    const sc = shakeCostNow(); e['shake-cost'].textContent = sc === 0 ? t('free') : sc;
    e['remove-cost'].textContent = CFG.removeCost;
    e['btn-remove'].disabled = !(G.state === 'playing' && G.removes < CFG.removeMax);
    e['btn-shake'].disabled = G.state !== 'playing';
  },
  refreshEvo(popLv = -1) {
    const imgs = this.els.evobar.children;
    for (let i = 0; i < imgs.length; i++) { imgs[i].classList.toggle('locked', !Save.isDiscovered(i)); if (i === popLv) { imgs[i].classList.add('pop'); setTimeout(() => imgs[i].classList.remove('pop'), 400); } }
  },
  setScore(v) { const el = this.els.score; el.textContent = v.toLocaleString(); el.classList.remove('punch'); void el.offsetWidth; el.classList.add('punch'); },
  setBest(v) { this.els.best.textContent = v.toLocaleString(); },
  setNext(lv) { const im = this.els['next-img']; im.src = `assets/candy/${String(lv + 1).padStart(2, '0')}.webp`; const s = 52 + lv * 7; im.style.width = s + '%'; im.style.height = s + '%'; },
  onState(s) { this.refresh(); },
  showHint(text, cancellable) { this.els['hint-text'].textContent = text; this.els['hint-cancel'].hidden = !cancellable; this.els.hint.hidden = false; },
  hideHint() { this.els.hint.hidden = true; },
  toast(msg) { const tt = this.els.toast; tt.textContent = msg; tt.hidden = false; clearTimeout(this._tt); this._tt = setTimeout(() => tt.hidden = true, 1800); },
  maybeDaily() { if (Save.tryDaily()) { Save.addGems(CFG.dailyGems); Audio.coin(); setTimeout(() => this.toast(t('daily_bonus', CFG.dailyGems)), 600); } },

  // ---- popup framework ----
  open(title, color, { wide = false, onClose = null, closable = true } = {}) {
    const dim = document.createElement('div'); dim.className = 'dim';
    const card = document.createElement('div'); card.className = 'card' + (wide ? ' wide' : '');
    if (title) { const rb = document.createElement('div'); rb.className = 'ribbon'; rb.style.setProperty('--c', color); rb.textContent = title; card.appendChild(rb); }
    if (closable) { const x = document.createElement('button'); x.className = 'close'; x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" fill="none"/></svg>'; x.onclick = () => { Audio.click(); this.close(dim); onClose && onClose(); }; card.appendChild(x); }
    dim.appendChild(card); this.els.popups.appendChild(dim);
    const wasPlaying = G.state === 'playing'; if (wasPlaying) { G.paused = true; }
    dim._wasPlaying = wasPlaying; dim._onClose = onClose;
    this.popupStack.push(dim);
    return card;
  },
  close(dim) {
    if (!dim) dim = this.popupStack[this.popupStack.length - 1]; if (!dim) return;
    const i = this.popupStack.indexOf(dim); if (i >= 0) this.popupStack.splice(i, 1);
    dim.remove();
    if (this.popupStack.length === 0) G.paused = false;
  },
  closeAll() { while (this.popupStack.length) this.close(); },
  onBack() {
    if (this.popupStack.length) { const top = this.popupStack[this.popupStack.length - 1]; if (top._noBack) return; const cb = top._onClose; this.close(top); cb && cb(); return; }
    if (G.state === 'playing') this.showMenu();
  },
  btn(label, cls, onClick, extra = '') { const b = document.createElement('button'); b.className = 'btn ' + cls + ' ' + extra; b.innerHTML = label; b.onclick = () => { Audio.click(); onClick && onClick(); }; return b; },
  el(tag, cls, html) { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; },
  gemHtml(n) { return `<img src="assets/gem.png" alt="" style="width:calc(44px*var(--s));height:calc(44px*var(--s));vertical-align:middle"> ${n}`; },

  // ---- menu ----
  showMenu() {
    if (G.state !== 'playing') return;
    const card = this.open(t('menu'), 'var(--green)');
    card.appendChild(this.btn(t('resume'), 'c-green wide', () => this.close()));
    card.appendChild(this.btn(t('restart'), 'c-orange wide', () => { this.closeAll(); startGame(); }));
    card.appendChild(this.toggleBtn(t('sound'), () => Save.d.sound, v => { Save.d.sound = v; Audio.enabled = v; Save.save(); Ads.setSound(v); }));
    card.appendChild(this.toggleBtn(t('vibration'), () => Save.d.vibration, v => { Save.d.vibration = v; Audio.vibrate = v; Save.save(); }));
    const lb = this.btn(`${t('language')}: ${LANG_NAMES[lang()]}`, 'c-blue wide', () => { const i = (LANGS.indexOf(lang()) + 1) % LANGS.length; setLang(LANGS[i]); Save.d.lang = LANGS[i]; Save.save(); this.applyTexts(); this.closeAll(); this.showMenu(); });
    card.appendChild(lb);
    card.appendChild(this.btn(t('how_to'), 'c-teal wide', () => this.showHowTo()));
    card.appendChild(this.btn(t('collection'), 'c-purple wide', () => this.showCollection()));
    const rs = this.btn(t('reset_data'), 'c-gray wide small', () => { if (confirm(t('reset_confirm'))) { Save.reset(); Audio.enabled = Save.d.sound; this.refreshEvo(); this.applyTexts(); this.closeAll(); startGame(); } });
    card.appendChild(rs);
    card.appendChild(this.el('p', 'note', 'KOGAMES · <a href="/" style="color:inherit">kogames.dev</a>'));
  },
  toggleBtn(label, get, set) {
    const b = this.btn('', (get() ? 'c-green' : 'c-gray') + ' wide toggle', null);
    const paint = () => { b.className = 'btn wide toggle ' + (get() ? 'c-green' : 'c-gray'); b.innerHTML = `${label}<b>${get() ? t('on') : t('off')}</b>`; };
    b.onclick = () => { Audio.click(); set(!get()); paint(); }; paint(); return b;
  },
  showHowTo() {
    const card = this.open(t('how_to'), 'var(--teal)');
    const row = this.el('div', 'row'); [0, 1, 2, 3, 4].forEach(lv => { const im = document.createElement('img'); im.src = `assets/candy/0${lv + 1}.webp`; im.style.width = `calc(${70 + lv * 14}px*var(--s))`; row.appendChild(im); });
    card.appendChild(row);
    card.appendChild(this.el('p', '', t('how_to_desc')));
    card.appendChild(this.el('p', 'note', t('earn_gems_hint')));
    card.appendChild(this.btn(t('confirm'), 'c-yellow wide', () => this.close()));
  },

  // ---- last chance ----
  showLastChance() {
    const card = this.open(t('last_chance'), 'var(--orange)', { onClose: () => finishGame() });
    const snap = this.el('div', 'snap'); snap.appendChild(snapshot()); card.appendChild(snap);
    card.appendChild(this.el('p', '', t('last_chance_desc')));
    const cost = continueCost();
    card.appendChild(this.btn(this.gemHtml(t('use_gems', cost)), 'c-green wide', () => {
      if (Save.spendGems(cost)) { this.closeAll(); continueGame(false); } else { this.toast(t('not_enough_gems')); this.showShop(); }
    }));
    if (G.adContinues < CFG.freeContinues) {
      const ab = this.btn('📺 ' + t('ad_continue'), 'c-blue wide tight', async () => {
        ab.disabled = true;
        const st = await Ads.reward('continue');
        if (st === 'viewed' || st === 'unavailable') { this.closeAll(); continueGame(true); }   // no fill → still free (never punish the player for our ad gaps)
        else { ab.disabled = false; this.toast(t('ad_not_finished')); }
      });
      card.appendChild(ab);
    }
  },

  // ---- result ----
  showResult() {
    const card = this.open(null, null, { wide: true, closable: false });
    card.style.background = '#DFF5C8';
    const top = this.el('div', 'row'); top.style.justifyContent = 'space-between';
    const mk = (cls, svg, fn) => { const b = document.createElement('button'); b.className = 'icon-btn ' + cls; b.innerHTML = svg; b.onclick = () => { Audio.click(); fn(); }; return b; };
    top.appendChild(mk('c-blue', '<svg viewBox="0 0 24 24"><path d="M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z"/></svg>', () => this.showRecords()));
    const title = this.el('div', 'result-title', t('result'));
    top.appendChild(title);
    top.appendChild(mk('c-pink', '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8 15.7 6.3M8.3 13.2l7.4 4.5" stroke-width="2.2" stroke="currentColor" fill="none"/></svg>', () => this.share()));
    card.appendChild(top);
    const rib = this.el('div', '', t('score')); rib.style.cssText = 'background:var(--pink);color:#fff;border-radius:999px;padding:calc(6px*var(--s)) calc(40px*var(--s));font-family:var(--font-display);font-weight:700;font-size:calc(34px*var(--s));text-shadow:0 2px 0 rgba(0,0,0,.3)';
    card.appendChild(rib);
    const sc = this.el('div', 'big-score', G.score.toLocaleString() + (G.isNewRecord ? ' <span class="badge-new">NEW</span>' : '')); card.appendChild(sc);
    const snap = this.el('div', 'snap'); snap.appendChild(snapshot()); card.appendChild(snap);
    card.appendChild(this.el('div', 'gemrow', `<img src="assets/gem.png" alt=""> +${G.endGems} <span style="opacity:.6">(${Save.d.gems.toLocaleString()})</span>`));
    card.appendChild(this.btn('↻ ' + t('retry'), 'c-blue wide', () => { this.closeAll(); startGame(); }));
    const foot = this.el('div', 'row'); foot.appendChild(this.btn(t('ranking'), 'c-yellow small', () => this.showRecords())); foot.appendChild(this.btn(t('collection'), 'c-teal small', () => this.showCollection())); card.appendChild(foot);
    if (Save.timeRewardLeftMs(CFG.timeRewardMin) === 0) setTimeout(() => { if (G.state === 'result') this.showTimeReward(); }, 700);
  },

  // ---- time reward ----
  showTimeReward() {
    const card = this.open(t('time_reward'), 'var(--orange)');
    card.appendChild(this.el('div', 'glow'));
    const im = document.createElement('img'); im.src = 'assets/chest.png'; im.className = 'chest'; card.appendChild(im);
    card.appendChild(this.el('div', 'gemrow', `<img src="assets/gem.png" alt=""> x${CFG.timeRewardGems}`));
    const ready = Save.timeRewardLeftMs(CFG.timeRewardMin) === 0;
    if (ready) {
      card.appendChild(this.el('p', 'note', t('time_reward_desc', CFG.timeRewardMin)));
      card.appendChild(this.btn(t('confirm'), 'c-yellow wide', () => { Save.addGems(CFG.timeRewardGems); Save.claimTimeReward(); Audio.coin(); burstScreen(); this.close(); }));
    } else {
      const tm = this.el('div', 'timer'); card.appendChild(tm);
      const tick = () => { const ms = Save.timeRewardLeftMs(CFG.timeRewardMin); const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60; tm.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; if (card.isConnected && ms > 0) setTimeout(tick, 500); };
      tick();
      card.appendChild(this.el('p', 'note', t('time_reward_desc', CFG.timeRewardMin)));
    }
  },

  // ---- gems info ("shop" without purchases) ----
  showShop() {
    const card = this.open(t('shop'), 'var(--pink)');
    card.appendChild(this.el('div', 'gemrow', `<img src="assets/gem.png" alt=""> ${Save.d.gems.toLocaleString()}`));
    card.appendChild(this.el('p', '', t('earn_gems_hint')));
    const ready = Save.timeRewardLeftMs(CFG.timeRewardMin) === 0;
    const today = new Date().toISOString().slice(0, 10); if (Save.d.adDay !== today) { Save.d.adDay = today; Save.d.adCount = 0; Save.save(); }
    const left = CFG.ads.gemsPerDay - Save.d.adCount;
    const gb = this.btn('📺 ' + t('ad_gems') + ' ' + this.gemHtml('+' + CFG.ads.gems) + ` <small>${Save.d.adCount}/${CFG.ads.gemsPerDay}</small>`, left > 0 ? 'c-green wide' : 'c-gray wide', async () => {
      if (left <= 0) { this.toast(t('ad_limit', Save.d.adCount, CFG.ads.gemsPerDay)); return; }
      gb.disabled = true;
      const st = await Ads.reward('gems');
      if (st === 'viewed') { Save.d.adCount++; Save.addGems(CFG.ads.gems); Audio.coin(); burstScreen(); this.toast(t('gem_bonus_end', CFG.ads.gems)); this.closeAll(); this.showShop(); }
      else { gb.disabled = false; this.toast(t(st === 'dismissed' ? 'ad_not_finished' : 'ad_unavailable')); }
    });
    card.appendChild(gb);
    card.appendChild(this.btn('🎁 ' + t('time_reward') + (ready ? '' : ' ⏳'), ready ? 'c-orange wide' : 'c-gray wide', () => this.showTimeReward()));
    card.appendChild(this.btn(t('confirm'), 'c-yellow wide', () => this.close()));
  },

  // ---- records ----
  showRecords() {
    const card = this.open(t('ranking'), 'var(--yellow)');
    card.appendChild(this.el('p', '', `${t('best')}: <b>${Save.d.best.toLocaleString()}</b> &nbsp;·&nbsp; ${t('weekly_best')}: <b>${Save.d.weekBest.toLocaleString()}</b>`));
    card.appendChild(this.el('h3', '', t('recent_records')));
    const list = this.el('div', 'list scroll');
    if (!Save.d.records.length) list.appendChild(this.el('p', '', t('no_records')));
    Save.d.records.forEach((r, i) => { list.appendChild(this.el('div', 'rec' + (r.score === Save.d.best ? ' top' : ''), `<span class="idx">${i + 1}</span><span class="sc">${r.score.toLocaleString()}</span><span class="dt">${r.date}</span>`)); });
    card.appendChild(list);
  },

  // ---- collection ----
  showCollection() {
    const card = this.open(t('collection'), 'var(--teal)', { wide: true });
    const grid = this.el('div', 'grid');
    for (let i = 0; i < 11; i++) {
      const d = Save.isDiscovered(i);
      grid.appendChild(this.el('div', 'cell', `<img src="assets/candy/${String(i + 1).padStart(2, '0')}.webp" class="${d ? '' : 'locked'}" alt=""><span>${d ? candyName(i) : '???'}</span><small>+${CFG.candies[i].s * CFG.scoreMul}</small>`));
    }
    card.appendChild(grid);
  },

  async share() {
    const url = 'https://kogames.dev/candy-merge/';
    const text = t('share_text', (G.score || Save.d.best).toLocaleString());
    try { if (navigator.share) { await navigator.share({ title: t('title'), text, url }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(text + url); this.toast(t('copied')); } catch (e) { prompt('URL', text + url); }
  },
};
function burstScreen() { const [cx, cy] = S2W(View.w / 2, View.h / 2); burst(cx, cy, 8, '#ffd93d', 2.2); }

// ---------------- boot ----------------
(function boot() {
  Save.load(); initLang(Save.d.lang); setLang(lang());
  Audio.enabled = Save.d.sound; Audio.vibrate = Save.d.vibration;
  Ads.onPause = () => { G._adPrevPaused = G.paused; G.paused = true; G._adPrevSound = Audio.enabled; Audio.enabled = false; };
  Ads.onResume = () => { G.paused = !!G._adPrevPaused; Audio.enabled = G._adPrevSound !== undefined ? G._adPrevSound : Save.d.sound; G.lastFrame = 0; };
  Ads.init(CFG.ads.client, { sound: Save.d.sound, test: location.hostname !== 'kogames.dev' || /[?&]adtest=1/.test(location.search) });
  resize(); UI.init(); window.__G = G; window.__dbg = { triggerGameOver, continueGame, finishGame, UI, Save, CFG }; // debug hooks
  loadAssets().then(() => { UI.refreshEvo(); });
  if (location.hash === '#about' || location.hash === '#howto') setTimeout(() => UI.showHowTo(), 300);
  requestAnimationFrame(frame);
  // unlock audio on first interaction
  const unlock = () => { Audio.init(); Audio.resume(); window.removeEventListener('pointerdown', unlock); }; window.addEventListener('pointerdown', unlock);
})();
})();
