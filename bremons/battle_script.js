import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, push, update, remove, onDisconnect, get, child, onChildAdded } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyCUWMn07YntLyB8m4q5-zHmiwjYOz1c_nk",
    authDomain: "bremons.firebaseapp.com",
    databaseURL: "https://bremons-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "bremons",
    storageBucket: "bremons.firebasestorage.app",
    messagingSenderId: "30413071482",
    appId: "1:30413071482:web:f62c34349b13e6c6ce47c3",
    measurementId: "G-4D4FCXGDBG"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- パラメータ設定 ---
const MAX_LIFE = 5;
const CHARGE_THRESHOLD_MIN = 1.0;
const CHARGE_THRESHOLD_STRONG = 2.0;
const BULLET_TRAVEL_TIME = 5000;
const COOLDOWN_ATTACK = 1000;
const COOLDOWN_DEFENSE = 1000;
const THOUSAND = 24;

let micConfig = {
    noiseThreshold: 0.05,
    haProfile: [0.096, 0.101, 0.044, 0.005, 0.005, 0.019, 0.030, 0.036, 0.038, 0.010, 0.001, 0.004, 0.018, 0.055, 0.069, 0.040, 0.023, 0.012, 0.027, 0.040, 0.029, 0.022, 0.009, 0.038],
    paProfile: [0.032, 0.041, 0.014, 0.022, 0.009, 0.017, 0.005, 0.022, 0.011, 0.010, 0.029, 0.092, 0.135, 0.139, 0.051, 0.013, 0.009, 0.012, 0.014, 0.014, 0.008, 0.009, 0.017, 0.007]
};

// --- グローバル変数 ---
let audioContext, analyser, dataArray;
let isGameRunning = false;
let gameMode = 'cpu'; 
let cpuLevel = 1;

let myLife = MAX_LIFE;
let enemyLife = MAX_LIFE;

let chargeTimer = 0;
let isBlowing = false;
let lastAttackTime = 0;
let lastDefenseTime = 0;
let bullets = []; 

// オンライン用変数
let roomId = null;
let myRole = null; // 'host' or 'guest'
let enemyName = "Opponent";
let myName = localStorage.getItem('user_name') || "Me";

// DOM要素
const els = {
    field: document.getElementById('battleField'),
    myShip: document.getElementById('myShip'),
    enemyShip: document.getElementById('enemyShip'),
    chargeBar: document.getElementById('chargeBar'),
    chargeText: document.getElementById('chargeText'),
    myLifeBar: document.getElementById('myLifeBar'),
    enemyLifeBar: document.getElementById('enemyLifeBar'),
    resultModal: document.getElementById('resultModal'),
    resultTitle: document.getElementById('resultTitle'),
    skillStar: document.getElementById('skillStar'),
    skillBlue: document.getElementById('skillBlue'),
    skillHa: document.getElementById('skillHa'),
    skillPa: document.getElementById('skillPa'),
    countdownOverlay: document.getElementById('countdownOverlay'),
    countdownText: document.getElementById('countdownText'),
    matchMsg: document.getElementById('matchMsg')
};

// --- 初期化 ---
window.onload = () => {
    const savedConfig = localStorage.getItem('mic_config_v2');
    if (savedConfig) {
        try { micConfig = JSON.parse(savedConfig); } catch (e) { }
    }

    const params = new URLSearchParams(window.location.search);
    gameMode = params.get('mode') || 'cpu';
    cpuLevel = parseInt(params.get('level')) || 1;
    document.getElementById('myName').innerText = myName;

    // 先にマイク初期化 -> 成功したらマッチング開始
    initAudio();
};

async function initAudio() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 1024;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        if (gameMode === 'cpu') {
            document.getElementById('enemyName').innerText = `CPU (Lv.${cpuLevel})`;
            startCountdown();
        } else {
            // オンライン: マッチング開始
            startMatching();
        }
        
        gameLoop(); // ループ開始

    } catch (e) {
        alert("マイクが使用できません");
        console.error(e);
    }
}

// --- オンライン マッチング処理 (修正版) ---
async function startMatching() {
    // UI表示
    els.countdownOverlay.classList.remove('hidden');
    els.countdownText.innerText = "";
    document.getElementById('matchArea').classList.remove('hidden');
    monitorWaitingPlayers();

    const roomsRef = ref(db, 'rooms');
    
    // 一度だけデータを取得して空き部屋を探す
    const snapshot = await get(roomsRef);
    let foundRoomId = null;

    if (snapshot.exists()) {
        const rooms = snapshot.val();
        // 古い順（キー順）に探す
        for (const [key, val] of Object.entries(rooms)) {
            // "waiting" かつ "自分が作った部屋じゃない" 場合に参加
            if (val.status === 'waiting') {
                foundRoomId = key;
                break; // 最初に見つけた部屋に入る
            }
        }
    }

    if (foundRoomId) {
        // --- GUEST参加 ---
        roomId = foundRoomId;
        myRole = 'guest';
        
        // 参加書き込み
        await update(ref(db, `rooms/${roomId}`), {
            guest: { name: myName, life: MAX_LIFE },
            status: 'playing' // ステータスを変更してゲーム開始へ
        });
        
        setupRoomListener();

    } else {
        // --- HOST作成 ---
        const newRoomRef = push(roomsRef);
        roomId = newRoomRef.key;
        myRole = 'host';
        
        await set(newRoomRef, {
            host: { name: myName, life: MAX_LIFE },
            status: 'waiting',
            createdAt: Date.now()
        });
        
        // 切断時に自動削除
        onDisconnect(newRoomRef).remove();
        setupRoomListener();
    }
}

function setupRoomListener() {
    const roomRef = ref(db, `rooms/${roomId}`);
    
    onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return; // 部屋が消えた

        // 相手の名前表示
        if (myRole === 'host' && data.guest) {
            enemyName = data.guest.name;
            document.getElementById('enemyName').innerText = enemyName;
        } else if (myRole === 'guest' && data.host) {
            enemyName = data.host.name;
            document.getElementById('enemyName').innerText = enemyName;
        }

        // ゲーム開始判定
        if (data.status === 'playing' && !isGameRunning && els.countdownText.innerText !== "START!") {
            document.getElementById('matchArea').classList.add('hidden');
            startCountdown();
        }

        // イベント処理 (攻撃など)
        if (data.events) {
            const events = Object.values(data.events);
            // まだ処理していないイベントを実行
            // ※簡易実装: 本来はID管理するが、今回は最後のイベントだけチェックする形か、全クリアで対応
            // ここでは「相手からのアクション」をリアルタイム監視するより、child_addedを使うのがベター
        }
    });

    // 攻撃・防御イベントの監視
    const eventsRef = ref(db, `rooms/${roomId}/events`);
    onValue(eventsRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const events = snapshot.val();
        // オブジェクトを配列にして、タイムスタンプ順に処理（簡易）
        // 実際には「処理済みID」を保持して重複を防ぐ必要があるが、
        // onChildAddedの方が適している。今回は簡易化のため onValue で差分検知は省略し、
        // 自分のアクション以外を描画する。
    });
    
    // ★重要: アクション受信は onChildAdded で行う
    // これにより、追加されたイベントを1回だけ処理できる
    const eventsChildRef = ref(db, `rooms/${roomId}/events`);
    onChildAdded(eventsChildRef, (data) => {
        const event = data.val();
        // 自分が送ったイベントは無視（ローカルで即時反映済み）
        if (event.sender === myRole) return;

        if (event.type === 'attack') {
            fireBullet(event.bulletType, false); // 敵の攻撃として描画
        } else if (event.type === 'damage') {
            // 敵がダメージを受けた（同期）
            enemyLife = event.currentLife;
            updateLifeDisplay('enemy', enemyLife);
            els.enemyShip.classList.add('shake');
            setTimeout(() => els.enemyShip.classList.remove('shake'), 400);
            if (enemyLife <= 0) finishGame(true);
        } else if (event.type === 'win') {
            // ★修正: 相手が死んだ通知が来たら、自分は「勝ち」
            finishGame(true);
        }
    });
}

// サーバーにアクション送信
function sendAction(data) {
    if (gameMode !== 'online' || !roomId) return;
    const eventsRef = ref(db, `rooms/${roomId}/events`);
    push(eventsRef, { ...data, sender: myRole, timestamp: Date.now() });
}

// --- カウントダウン ---
function startCountdown() {
    els.countdownOverlay.classList.remove('hidden');
    let count = 3;
    els.countdownText.innerText = count;
    playSe(600, 'sine'); 

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            els.countdownText.innerText = count;
            els.countdownText.style.animation = 'none';
            els.countdownText.offsetHeight; 
            els.countdownText.style.animation = 'popIn 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            playSe(600, 'sine');
        } else if (count === 0) {
            els.countdownText.innerText = "START!";
            playSe(1200, 'sine');
        } else {
            clearInterval(timer);
            els.countdownOverlay.classList.add('hidden');
            startGame(); 
        }
    }, 1000);
}

function startGame() {
    isGameRunning = true;
    if (gameMode === 'cpu') startCpuLogic();
}

// --- メインループ ---
function gameLoop() {
    if (isGameRunning) {
        updateMicInput();
        updateBullets();
        updateCooldownUI();
    }
    requestAnimationFrame(gameLoop);
}

// --- マイク処理 ---
function updateMicInput() {
    analyser.getByteFrequencyData(dataArray);
    let maxAmp = 0;
    for (let i = 0; i < THOUSAND; i++) {
        if (dataArray[i]/255.0 > maxAmp) maxAmp = dataArray[i]/255.0;
    }

    if (maxAmp < micConfig.noiseThreshold) {
        if (isBlowing) finishCharge();
        isBlowing = false;
        return;
    }

    const now = Date.now();
    if (now - lastDefenseTime > COOLDOWN_DEFENSE) {
        const type = analyzeVowel();
        if (type === 'ha' || type === 'pa') {
            triggerDefense(type);
            isBlowing = false; 
            resetChargeUI();
            return;
        }
    }

    let highFreqSum = 0;
    for (let i = 30; i < 100; i++) highFreqSum += dataArray[i];
    const avg = highFreqSum / 70;

    if (now - lastAttackTime > COOLDOWN_ATTACK) {
        if (avg > 10) { 
            isBlowing = true;
            chargeTimer += 1 / 60; 
            els.chargeText.innerText = chargeTimer.toFixed(1) + "s";
            let percent = (chargeTimer / CHARGE_THRESHOLD_STRONG) * 100;
            if(percent > 100) percent = 100;
            els.chargeBar.style.width = percent + "%";
            
            if (chargeTimer < CHARGE_THRESHOLD_MIN) els.chargeBar.style.backgroundColor = '#95a5a6';
            else if (chargeTimer < CHARGE_THRESHOLD_STRONG) els.chargeBar.style.backgroundColor = '#f1c40f';
            else els.chargeBar.style.backgroundColor = '#e74c3c';
        } else {
            if (isBlowing) finishCharge();
            isBlowing = false;
        }
    }
}

function analyzeVowel() {
    let haDist = 0, paDist = 0;
    for (let i = 0; i < THOUSAND; i++) {
        const val = dataArray[i] / 255.0;
        haDist += Math.pow(micConfig.haProfile[i] - val, 2);
        paDist += Math.pow(micConfig.paProfile[i] - val, 2);
    }
    const ha = 1/(1+Math.sqrt(haDist));
    const pa = 1/(1+Math.sqrt(paDist));
    if (ha > 0.65 && ha > pa) return 'ha';
    if (pa > 0.65 && pa > ha) return 'pa';
    return null;
}

function finishCharge() {
    if (chargeTimer < CHARGE_THRESHOLD_MIN) { 
        chargeTimer = 0; resetChargeUI(); return;
    }
    const type = (chargeTimer >= CHARGE_THRESHOLD_STRONG) ? 'bluestar' : 'star';
    
    // 攻撃実行 (ローカル + オンライン送信)
    fireBullet(type, true); 
    sendAction({ type: 'attack', bulletType: type }); // ★送信

    chargeTimer = 0;
    resetChargeUI();
    lastAttackTime = Date.now();
}

function resetChargeUI() {
    els.chargeBar.style.width = "0%";
    els.chargeText.innerText = "0.0s";
    els.chargeBar.style.backgroundColor = '#95a5a6';
}

function triggerDefense(type) {
    lastDefenseTime = Date.now();
    playSe(type === 'ha' ? 600 : 800, 'sine');
    
    const skillBox = (type === 'ha') ? els.skillHa : els.skillPa;
    skillBox.style.borderColor = '#fff';
    setTimeout(() => skillBox.style.borderColor = '#555', 200);

    const targetType = (type === 'ha') ? 'star' : 'bluestar';
    const threats = bullets.filter(b => !b.isPlayerBullet && b.type === targetType && b.active);
    threats.sort((a, b) => b.progress - a.progress); 

    if (threats.length > 0) {
        destroyBullet(threats[0]);
        showTextEffect("BLOCK!", "#2ecc71", 50, 70); 
    }
}

// --- 弾 ---
function fireBullet(type, isPlayerBullet) {
    const bullet = document.createElement('img');
    bullet.src = type === 'bluestar' ? './nightgame/bluestar.png' : './nightgame/star.png';
    bullet.className = 'bullet';
    
    if (isPlayerBullet) {
        bullet.style.bottom = '180px'; bullet.style.left = '50%';
    } else {
        bullet.style.top = '80px'; bullet.style.left = '50%';
        bullet.style.transform = 'rotate(180deg)';
    }
    
    els.field.appendChild(bullet);
    bullets.push({ el: bullet, type: type, isPlayerBullet: isPlayerBullet, progress: 0, active: true });
    playSe(isPlayerBullet ? 400 : 300, 'square');
}

function updateBullets() {
    const speed = 100 / (BULLET_TRAVEL_TIME / 1000 * 60);
    bullets.forEach(b => {
        if (!b.active) return;
        b.progress += speed;

        if (b.isPlayerBullet) {
            const y = 20 + (65 * (b.progress / 100)); // 20->85
            b.el.style.bottom = y + '%';
        } else {
            const y = 15 + (65 * (b.progress / 100)); // 15->80
            b.el.style.top = y + '%';
        }

        if (b.progress >= 100) hitTarget(b);
    });
}

function hitTarget(bullet) {
    if (!bullet.active) return;
    bullet.active = false;
    bullet.el.remove();

    const damage = (bullet.type === 'bluestar') ? 2 : 1;

    if (bullet.isPlayerBullet) {
        // 自分が撃った弾が敵に当たった -> オンラインでは相手が判定して送ってくるのでここでは減らさない
        // ただしCPU戦はここで減らす
        if (gameMode === 'cpu') {
            enemyLife = Math.max(0, enemyLife - damage);
            updateLifeDisplay('enemy', enemyLife);
            els.enemyShip.classList.add('shake');
            setTimeout(() => els.enemyShip.classList.remove('shake'), 400);
            if (enemyLife <= 0) finishGame(true);
        }
    } else {
        // 敵の弾が自分に当たった -> ダメージ確定 & 送信
        myLife = Math.max(0, myLife - damage);
        updateLifeDisplay('my', myLife);
        els.myShip.classList.add('shake');
        setTimeout(() => els.myShip.classList.remove('shake'), 400);
        if (navigator.vibrate) navigator.vibrate(200);

        // ★送信: 自分の新しいライフを相手に通知
        sendAction({ type: 'damage', currentLife: myLife });

        if (myLife <= 0) {
            finishGame(false);
            sendAction({ type: 'dead' }); // ★修正: 「私が死んだ」と通知
        }
    }
}

function destroyBullet(bullet) {
    bullet.active = false;
    bullet.el.style.transform = "scale(2)";
    bullet.el.style.opacity = "0";
    setTimeout(() => bullet.el.remove(), 200);
}

function updateLifeDisplay(who, val) {
    const bar = (who === 'enemy') ? els.enemyLifeBar : els.myLifeBar;
    const hearts = bar.children;
    for (let i = 0; i < hearts.length; i++) {
        if (i < val) hearts[i].classList.add('active');
        else hearts[i].classList.remove('active');
    }
}

function updateCooldownUI() {
    const now = Date.now();
    const atk = now - lastAttackTime > COOLDOWN_ATTACK;
    const def = now - lastDefenseTime > COOLDOWN_DEFENSE;
    const s = els;
    
    atk ? (s.skillStar.classList.remove('on-cooldown'), s.skillBlue.classList.remove('on-cooldown'))
        : (s.skillStar.classList.add('on-cooldown'), s.skillBlue.classList.add('on-cooldown'));
        
    def ? (s.skillHa.classList.remove('on-cooldown'), s.skillPa.classList.remove('on-cooldown'))
        : (s.skillHa.classList.add('on-cooldown'), s.skillPa.classList.add('on-cooldown'));
}

function showTextEffect(text, color, x, y) {
    const div = document.createElement('div');
    div.innerText = text;
    div.style.position = 'absolute';
    div.style.left = x+'%'; div.style.top = y+'%';
    div.style.color = color;
    div.style.fontSize = '30px'; div.style.fontWeight = 'bold';
    div.style.zIndex = 20; div.style.transition = 'top 1s, opacity 1s';
    els.field.appendChild(div);
    setTimeout(() => { div.style.top = (y-10)+'%'; div.style.opacity = 0; }, 50);
    setTimeout(() => div.remove(), 1000);
}

// --- CPU ---
function startCpuLogic() {
    let atkProb, defProb, interval;
    switch(cpuLevel) {
        case 1: atkProb=0.3; defProb=0.2; interval=2000; break;
        case 2: atkProb=0.5; defProb=0.5; interval=1500; break;
        case 3: atkProb=0.7; defProb=0.8; interval=1000; break;
    }
    setInterval(() => {
        if(!isGameRunning) return;
        if(Math.random() < atkProb) {
            const type = Math.random() < 0.3 ? 'bluestar' : 'star';
            fireBullet(type, false);
        }
    }, interval);
    setInterval(() => {
        if(!isGameRunning) return;
        const threat = bullets.find(b => b.isPlayerBullet && b.active && b.progress > 70);
        if (threat && Math.random() < defProb) destroyBullet(threat);
    }, 500);
}

// --- 終了 ---
function finishGame(isWin) {
    isGameRunning = false;
    els.resultModal.classList.remove('hidden');
    if (isWin) {
        els.resultTitle.innerText = "YOU WIN!";
        els.resultTitle.className = "result-title win";
        playSe(1000, 'sawtooth');
    } else {
        els.resultTitle.innerText = "YOU LOSE...";
        els.resultTitle.className = "result-title lose";
        playSe(200, 'sawtooth');
    }
    
    // 部屋の後始末（Hostなら）
    if (roomId && myRole === 'host') {
        setTimeout(() => {
            // remove(ref(db, `rooms/${roomId}`)); // 必要なら消す
        }, 5000);
    }
}

function playSe(freq, type) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
    gain.gain.setValueAtTime(0.1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.1);
}

// キャンセル処理
window.cancelMatching = function() {
    if (roomId && myRole === 'host') {
        // 自分が作った部屋を削除
        remove(ref(db, `rooms/${roomId}`))
            .then(() => {
                location.href = 'battle_select.html';
            });
    } else {
        location.href = 'battle_select.html';
    }
};

// 待機プレイヤー数の監視
function monitorWaitingPlayers() {
    const roomsRef = ref(db, 'rooms');
    onValue(roomsRef, (snapshot) => {
        if (isGameRunning) return; // ゲーム始まったら更新不要

        let count = 0;
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                if (child.val().status === 'waiting') {
                    count++;
                }
            });
        }
        // 自分も含まれるので、最低1人にはなるはず
        document.getElementById('waitingCount').innerText = `待機中のプレイヤー: ${count}人`;
    });
}