// --- パラメータ設定 ---
const MAX_LIFE = 5;
const CHARGE_THRESHOLD_MIN = 1.0;    // ★変更: 1秒未満は不発（はっ/ぱっ誤爆防止）
const CHARGE_THRESHOLD_STRONG = 2.0; // 2秒以上で青星
const BULLET_TRAVEL_TIME = 5000;     // 5秒で着弾
const COOLDOWN_ATTACK = 1000;        // 攻撃クールタイム 1秒
const COOLDOWN_DEFENSE = 1000;       // 防御クールタイム 1秒

// 音声認識用定数
const THOUSAND = 24;
// デフォルト設定
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

let chargeTimer = 0; // ふ～の継続時間
let isBlowing = false;

let lastAttackTime = 0;
let lastDefenseTime = 0;

let bullets = []; // 飛んでいる弾の管理配列

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
    // スキルアイコン
    skillStar: document.getElementById('skillStar'),
    skillBlue: document.getElementById('skillBlue'),
    skillHa: document.getElementById('skillHa'),
    skillPa: document.getElementById('skillPa'),
    // カウントダウン用
    countdownOverlay: document.getElementById('countdownOverlay'),
    countdownText: document.getElementById('countdownText')
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

    if (gameMode === 'cpu') {
        document.getElementById('enemyName').innerText = `CPU (Lv.${cpuLevel})`;
        initAudio();
    } else {
        alert("オンライン対戦は準備中です。CPU戦を開始します。");
        gameMode = 'cpu';
        initAudio();
    }
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

        startCountdown();
        gameLoop();

    } catch (e) {
        alert("マイクが使用できません");
        console.error(e);
    }
}

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

// マイク入力処理
function updateMicInput() {
    analyser.getByteFrequencyData(dataArray);

    let maxAmp = 0;
    for (let i = 0; i < THOUSAND; i++) {
        const val = dataArray[i] / 255.0;
        if (val > maxAmp) maxAmp = val;
    }

    if (maxAmp < micConfig.noiseThreshold) {
        if (isBlowing) {
            finishCharge(); // 息を止めたら発射判定へ
        }
        isBlowing = false;
        return;
    }

    const now = Date.now();
    
    // 1. 防御判定 ("はっ", "ぱっ")
    // クールタイム中でなければ判定
    if (now - lastDefenseTime > COOLDOWN_DEFENSE) {
        const type = analyzeVowel();
        if (type === 'ha') {
            triggerDefense('ha');
            isBlowing = false; // 防御したらチャージキャンセル
            resetChargeUI();
            return; 
        } else if (type === 'pa') {
            triggerDefense('pa');
            isBlowing = false;
            resetChargeUI();
            return;
        }
    }

    // 2. 攻撃チャージ判定 ("ふ〜")
    let highFreqSum = 0;
    for (let i = 30; i < 100; i++) highFreqSum += dataArray[i];
    const highFreqAvg = highFreqSum / 70;

    if (now - lastAttackTime > COOLDOWN_ATTACK) {
        if (highFreqAvg > 10) { 
            isBlowing = true;
            chargeTimer += 1 / 60; 
            
            // UI更新
            els.chargeText.innerText = chargeTimer.toFixed(1) + "s";
            let percent = (chargeTimer / CHARGE_THRESHOLD_STRONG) * 100;
            if (percent > 100) percent = 100;
            els.chargeBar.style.width = percent + "%";
            
            // ★色変化ロジックの変更
            if (chargeTimer < CHARGE_THRESHOLD_MIN) {
                // 1秒未満: まだ撃てない (グレー)
                els.chargeBar.style.backgroundColor = '#95a5a6';
            } else if (chargeTimer < CHARGE_THRESHOLD_STRONG) {
                // 1~2秒: Star発射可能 (黄色)
                els.chargeBar.style.backgroundColor = '#f1c40f';
            } else {
                // 2秒以上: BlueStar発射可能 (赤色)
                els.chargeBar.style.backgroundColor = '#e74c3c';
            }

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
    const haScore = 1 / (1 + Math.sqrt(haDist));
    const paScore = 1 / (1 + Math.sqrt(paDist));

    if (haScore > 0.65 && haScore > paScore) return 'ha';
    if (paScore > 0.65 && paScore > haScore) return 'pa';
    return null;
}

// チャージ終了 -> 攻撃実行
function finishCharge() {
    // ★変更: 1秒未満は無視する（防御ボイスなどの誤爆防止）
    if (chargeTimer < CHARGE_THRESHOLD_MIN) { 
        chargeTimer = 0;
        resetChargeUI();
        return;
    }

    const type = (chargeTimer >= CHARGE_THRESHOLD_STRONG) ? 'bluestar' : 'star';
    fireBullet(type, true); // プレイヤーの攻撃

    chargeTimer = 0;
    resetChargeUI();
    lastAttackTime = Date.now();
}

function resetChargeUI() {
    els.chargeBar.style.width = "0%";
    els.chargeText.innerText = "0.0s";
    els.chargeBar.style.backgroundColor = '#95a5a6'; // 初期色はグレー
}

// 防御実行
function triggerDefense(type) {
    lastDefenseTime = Date.now();
    playSe(type === 'ha' ? 600 : 800, 'sine'); 
    
    // UIエフェクト
    const skillBox = (type === 'ha') ? els.skillHa : els.skillPa;
    skillBox.style.borderColor = '#fff';
    setTimeout(() => skillBox.style.borderColor = '#555', 200);

    const targetType = (type === 'ha') ? 'star' : 'bluestar';
    const threats = bullets.filter(b => !b.isPlayerBullet && b.type === targetType && b.active);
    threats.sort((a, b) => b.progress - a.progress); 

    if (threats.length > 0) {
        const target = threats[0];
        destroyBullet(target);
        showTextEffect("BLOCK!", "#2ecc71", 50, 70); 
    }
}

// --- 弾の処理 ---
function fireBullet(type, isPlayerBullet) {
    const bullet = document.createElement('img');
    bullet.src = type === 'bluestar' ? './nightgame/bluestar.png' : './nightgame/star.png';
    bullet.className = 'bullet';
    
    if (isPlayerBullet) {
        bullet.style.bottom = '180px'; 
        bullet.style.left = '50%';
    } else {
        bullet.style.top = '80px';
        bullet.style.left = '50%';
        bullet.style.transform = 'rotate(180deg)';
    }
    
    els.field.appendChild(bullet);

    bullets.push({
        el: bullet,
        type: type,
        isPlayerBullet: isPlayerBullet,
        progress: 0, 
        active: true
    });

    playSe(isPlayerBullet ? 400 : 300, 'square');
}

function updateBullets() {
    // 弾の移動速度 (100% / 5秒 / 60fps)
    const speed = 100 / (BULLET_TRAVEL_TIME / 1000 * 60);

    bullets.forEach(b => {
        if (!b.active) return;

        b.progress += speed;

        if (b.isPlayerBullet) {
            const startY = 20; 
            const endY = 85;   
            const currentY = startY + (endY - startY) * (b.progress / 100);
            b.el.style.bottom = currentY + '%';
        } else {
            const startY = 15; 
            const endY = 80;   
            const currentY = startY + (endY - startY) * (b.progress / 100);
            b.el.style.top = currentY + '%';
        }

        if (b.progress >= 100) {
            hitTarget(b);
        }
    });
}

function hitTarget(bullet) {
    if (!bullet.active) return;
    bullet.active = false;
    bullet.el.remove();

    const damage = (bullet.type === 'bluestar') ? 2 : 1;

    if (bullet.isPlayerBullet) {
        // 敵に命中
        enemyLife = Math.max(0, enemyLife - damage);
        updateLifeDisplay('enemy', enemyLife);
        els.enemyShip.classList.add('shake');
        setTimeout(() => els.enemyShip.classList.remove('shake'), 400);
        
        if (enemyLife <= 0) finishGame(true);

    } else {
        // 自分に命中
        myLife = Math.max(0, myLife - damage);
        updateLifeDisplay('my', myLife);
        els.myShip.classList.add('shake');
        setTimeout(() => els.myShip.classList.remove('shake'), 400);
        
        if (navigator.vibrate) navigator.vibrate(200); 

        if (myLife <= 0) finishGame(false);
    }
}

function destroyBullet(bullet) {
    bullet.active = false;
    bullet.el.style.transition = "transform 0.2s, opacity 0.2s";
    bullet.el.style.transform = "scale(2)";
    bullet.el.style.opacity = "0";
    setTimeout(() => bullet.el.remove(), 200);
}

function updateLifeDisplay(who, val) {
    const bar = (who === 'enemy') ? els.enemyLifeBar : els.myLifeBar;
    const hearts = bar.children;
    for (let i = 0; i < hearts.length; i++) {
        if (i < val) {
            hearts[i].classList.add('active');
        } else {
            hearts[i].classList.remove('active');
        }
    }
}

function updateCooldownUI() {
    const now = Date.now();
    const atkReady = now - lastAttackTime > COOLDOWN_ATTACK;
    const defReady = now - lastDefenseTime > COOLDOWN_DEFENSE;

    if(atkReady) {
        els.skillStar.classList.remove('on-cooldown');
        els.skillBlue.classList.remove('on-cooldown');
    } else {
        els.skillStar.classList.add('on-cooldown');
        els.skillBlue.classList.add('on-cooldown');
    }

    if(defReady) {
        els.skillHa.classList.remove('on-cooldown');
        els.skillPa.classList.remove('on-cooldown');
    } else {
        els.skillHa.classList.add('on-cooldown');
        els.skillPa.classList.add('on-cooldown');
    }
}

function showTextEffect(text, color, xPerc, yPerc) {
    const div = document.createElement('div');
    div.innerText = text;
    div.style.position = 'absolute';
    div.style.left = xPerc + '%';
    div.style.top = yPerc + '%';
    div.style.color = color;
    div.style.fontSize = '30px';
    div.style.fontWeight = 'bold';
    div.style.textShadow = '2px 2px 0 #000';
    div.style.zIndex = 20;
    div.style.transition = 'top 1s, opacity 1s';
    els.field.appendChild(div);

    setTimeout(() => {
        div.style.top = (yPerc - 10) + '%';
        div.style.opacity = 0;
    }, 50);
    setTimeout(() => div.remove(), 1000);
}

// --- CPUロジック ---
function startCpuLogic() {
    let attackProb, defenseProb, actionInterval;
    switch(cpuLevel) {
        case 1: attackProb=0.3; defenseProb=0.2; actionInterval=2000; break; 
        case 2: attackProb=0.5; defenseProb=0.5; actionInterval=1500; break; 
        case 3: attackProb=0.7; defenseProb=0.8; actionInterval=1000; break; 
    }

    setInterval(() => {
        if(!isGameRunning) return;
        if(Math.random() < attackProb) {
            const type = Math.random() < 0.3 ? 'bluestar' : 'star';
            fireBullet(type, false); 
        }
    }, actionInterval);

    setInterval(() => {
        if(!isGameRunning) return;
        const threat = bullets.find(b => b.isPlayerBullet && b.active && b.progress > 70); 
        if (threat && Math.random() < defenseProb) {
            destroyBullet(threat);
        }
    }, 500); 
}

// --- ゲーム終了 ---
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
}

// 簡易SE
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