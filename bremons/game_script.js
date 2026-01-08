// --- 設定データ ---
const STAGE_DATA = {
    1: { distance: 100000000, name: "惑星インハレスへの旅路" },
    2: { distance: 150000000, name: "惑星エクセールへ" },
    3: { distance: 300000000, name: "惑星プネウマへ" }
};

// ゲームの状態管理
const STATE = {
    INIT: 0,
    COUNTDOWN: 1,
    FUELING: 2,
    FLYING: 3,
    RESULT: 4,
    PAUSED: 5
};

let currentState = STATE.INIT;
let lastState = STATE.INIT;
let audioContext, analyser, dataArray, microphone;
let isMicActive = false;

// ステージ設定
let currentStageNum = 1;
let goalDistance = 100000000;

// パラメータ
let fuelSeconds = 0;       
let chargedFuelSeconds = 0; 
let flightDistance = 0;    
let totalDistance = 0;     
const FLIGHT_SPEED = 500000; // 速度10倍
const MAX_FUEL_SEC = 20;

// フラグ
let hasStartedBlowing = false; 
let fuelingDone = false;       

// --- 音声認識用データ (C#から移植) ---
// 0~23番目の周波数ビン（低音域）の特徴量
const THOUSAND_INDEX = 24;
const Fu_array = [0.04663889, 0.08273548, 0.1707033, 0.1037671, 0.05075672, 0.02912107, 0.07029577, 0.02660729, 0.07701397, 0.07358543, 0.03582431, 0.034128, 0.06408661, 0.0669658, 0.04760632, 0.03390676, 0.04892594, 0.04976312, 0.0779156, 0.08174721, 0.05171812, 0.03128907, 0.03644949, 0.0191151];
const Ha_array = [0.09666242, 0.1010209, 0.04417039, 0.005689631, 0.005637815, 0.01925762, 0.03026361, 0.0365145, 0.0382, 0.01092663, 0.00179, 0.00457, 0.01878265, 0.055, 0.06935102, 0.0409, 0.0239, 0.0127, 0.027, 0.0401, 0.0292, 0.0226, 0.00922, 0.0389];
const Pa_array = [0.03245861, 0.04191279, 0.01490102, 0.02225155, 0.009038828, 0.01731531, 0.005591091, 0.02210945, 0.0117, 0.0108, 0.0292, 0.0925, 0.135, 0.139, 0.0511, 0.0134, 0.00949, 0.0122, 0.014, 0.0142, 0.0084, 0.00948, 0.0178, 0.00705];

// DOM要素
const els = {
    bg: document.getElementById('gameBg'),
    rocket: document.getElementById('rocket'),
    msgArea: document.getElementById('messageArea'),
    fuelTime: document.getElementById('fuelTime'),
    fuelBar: document.getElementById('fuelBar'),
    remainDist: document.getElementById('remainDist'),
    micLevel: document.getElementById('micLevel'),
    paBtn: document.getElementById('paBtn'),
    
    threshVal: document.getElementById('threshVal_pause'),
    sensitivity: document.getElementById('sensitivity_pause'),
    
    gameLayer: document.getElementById('gameLayer'),
    modal: document.getElementById('resultModal'),
    resDist: document.getElementById('resultDist'),
    totalDistDisplay: document.getElementById('totalDistDisplay'),
    cdOverlay: document.getElementById('countdownOverlay'),
    cdText: document.getElementById('countdownText'),
    mapMarker: document.getElementById('mapMarker'),
    bgm: document.getElementById('bgm'),
    
    gameHeader: document.getElementById('gameHeader'),
    stageNameDisplay: document.getElementById('stageNameDisplay'),
    pauseModal: document.getElementById('pauseModal')
};

// ■ 初期化・データロード
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const stageParam = urlParams.get('stage');
    if (stageParam && STAGE_DATA[stageParam]) {
        currentStageNum = parseInt(stageParam);
    }
    goalDistance = STAGE_DATA[currentStageNum].distance;

    els.stageNameDisplay.innerText = STAGE_DATA[currentStageNum].name;

    els.sensitivity.addEventListener('input', () => {
         els.threshVal.innerText = els.sensitivity.value;
    });

    loadGameData();
    updateDistanceDisplay();
});

async function loadGameData() {
    if (window.DB && window.DB.load) {
        totalDistance = await window.DB.load();
        console.log("Cloud Loaded: " + totalDistance);
        updateDistanceDisplay();
    }
}

// ■ マイク初期化
async function initGame() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        
        // ★重要: C#のFFT設定に近づけるためサイズを調整
        // UnityのsamplingRange=512に近づけるため、fftSize=1024 (bin数512) に設定
        analyser.fftSize = 1024; 
        
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        isMicActive = true;
        
        els.msgArea.style.display = 'none';
        
        els.bgm.pause();
        els.bgm.currentTime = 0;

        startCountdown();

    } catch (err) {
        alert("マイクの使用が許可されませんでした。");
    }
}

// ■ カウントダウン
function startCountdown() {
    currentState = STATE.COUNTDOWN;
    els.cdOverlay.classList.remove('hidden');
    let count = 3;
    els.cdText.innerText = count;
    playBlipSound(600); 

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            els.cdText.innerText = count;
            playBlipSound(600);
            els.cdText.style.animation = 'none';
            els.cdText.offsetHeight; 
            els.cdText.style.animation = 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        } else {
            clearInterval(timer);
            els.cdOverlay.classList.add('hidden');
            currentState = STATE.FUELING;
            
            els.gameHeader.style.display = 'flex';
            
            // ボタンの文言変更（音声認識を促す）
            els.paBtn.innerText = "ぱっ！と言って発射"; 
            els.paBtn.disabled = true;
            playBlipSound(1000); 
            
            gameLoop();
        }
    }, 1000);
}

// ■ ポーズ切り替え
window.togglePause = function() {
    if (currentState === STATE.PAUSED) {
        currentState = lastState;
        els.pauseModal.classList.add('hidden');
        if (currentState === STATE.FLYING) {
            els.bgm.play();
            els.bg.classList.remove('speed-stop');
        }
    } else {
        if (currentState === STATE.RESULT) return;
        lastState = currentState;
        currentState = STATE.PAUSED;
        els.pauseModal.classList.remove('hidden');
        els.bgm.pause();
        els.bg.classList.add('speed-stop');
    }
};

// ■ メインループ
function gameLoop() {
    if (currentState === STATE.PAUSED) {
        requestAnimationFrame(gameLoop);
        return;
    }

    if (!isMicActive) return;
    analyser.getByteFrequencyData(dataArray);
    
    // 音量計算
    let sum = 0;
    for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
    let average = sum / dataArray.length;
    
    const sensVal = parseInt(els.sensitivity.value);
    const threshold = 100 - (sensVal * 0.9); 
    els.threshVal.innerText = sensVal;

    let visualLevel = Math.min(100, (average / 50) * 100);
    els.micLevel.style.width = visualLevel + '%';
    const isOverThreshold = average > threshold;
    els.micLevel.style.backgroundColor = isOverThreshold ? '#e74c3c' : '#2ecc71';

    // ★音声認識の実行
    const recognizedSound = analyzeVoice(dataArray);

    if (currentState === STATE.FUELING) {
        // 給油処理
        processFueling(average, threshold, isOverThreshold, recognizedSound);
    } else if (currentState === STATE.FLYING) {
        processFlying(average, threshold);
    }
    requestAnimationFrame(gameLoop);
}

// ★音声認識ロジック (C#から移植・JS用に調整)
function analyzeVoice(data) {
    // データがない、または音が小さすぎる場合は計算しない
    // 0.05 (Unity) ≒ 12.75 (Byte: 0-255) なので、少し余裕を見て判定
    let max_amplitude = 0;
    
    // 類似度計算用変数
    let Fu_euclid = 0;
    let Ha_euclid = 0;
    let Pa_euclid = 0;

    // 低周波数帯 (0~23) のみを比較
    for (let i = 0; i < THOUSAND_INDEX; i++) {
        // data[i] は 0-255 なので 0.0-1.0 に正規化
        const spectrumVal = data[i] / 255.0; 

        if (spectrumVal > max_amplitude) max_amplitude = spectrumVal;

        // 差の二乗を足していく
        Fu_euclid += Math.pow(Fu_array[i] - spectrumVal, 2);
        Ha_euclid += Math.pow(Ha_array[i] - spectrumVal, 2);
        Pa_euclid += Math.pow(Pa_array[i] - spectrumVal, 2);
    }

    // オッズ計算 (1 / (1 + √誤差和))
    const Fu_odds = 1 / (1 + Math.sqrt(Fu_euclid));
    const Ha_odds = 1 / (1 + Math.sqrt(Ha_euclid));
    const Pa_odds = 1 / (1 + Math.sqrt(Pa_euclid));

    // 判定 (C#の閾値をそのまま使用)
    // 音量が小さい(max_amplitude < 0.05)場合は無視
    if (max_amplitude < 0.05) return null;

    if (Ha_odds >= 0.83) {
        // console.log("検出: はっ", Ha_odds);
        return "はっ";
    } else if (Pa_odds >= 0.70) {
        console.log("検出: ぱっ！", Pa_odds); // ログで確認用
        return "ぱっ";
    }

    return null;
}

// ■ 給油ロジック
function processFueling(volume, threshold, isOverThreshold, recognizedSound) {
    if (fuelingDone) {
        // 給油完了後、発射待ち状態
        // ★修正: 「ぱっ」と聞こえたら発射
        if (recognizedSound === "ぱっ") {
            launchRocket();
        }
        return;
    }

    if (isOverThreshold) {
        if (!hasStartedBlowing) hasStartedBlowing = true;
        
        fuelSeconds += 1 / 60;
        chargedFuelSeconds = fuelSeconds; 
        els.fuelTime.innerText = fuelSeconds.toFixed(2);
        
        let barPercent = (fuelSeconds / MAX_FUEL_SEC) * 100;
        if (fuelSeconds > MAX_FUEL_SEC) {
            barPercent = 100;
            els.fuelBar.classList.add('overcharge');
        } else {
            els.fuelBar.classList.remove('overcharge');
        }
        els.fuelBar.style.width = barPercent + '%';

    } else {
        if (hasStartedBlowing) {
            fuelingDone = true;
            
            // ボタンでも発射できるようにしておく
            els.paBtn.disabled = false;
            els.paBtn.innerText = "「ぱっ！」と言って発射"; // 文言変更
            els.paBtn.style.backgroundColor = "#e74c3c";
            els.paBtn.onclick = launchRocket;
            
            els.fuelBar.classList.remove('overcharge');
            playBlipSound(800);
        }
    }
}

// ■ 発射処理
function launchRocket() {
    currentState = STATE.FLYING;
    flightDistance = 0; 
    
    els.bgm.currentTime = 0;
    els.bgm.volume = 0.3;
    els.bgm.play();
    
    els.paBtn.innerText = "はっ！(キャッチ)";
    els.paBtn.style.backgroundColor = "#f39c12";
    els.paBtn.onclick = null; 

    els.bg.classList.remove('speed-stop');
    els.bg.classList.add('speed-fast');
    document.body.classList.add('flying');
    
    spawnFlyingMonsters();
}

// ■ 飛行中ロジック
function processFlying(volume, threshold) {
    const timeDelta = 1 / 60;
    
    const distDelta = FLIGHT_SPEED * timeDelta;
    flightDistance += distDelta;   
    totalDistance += distDelta;    
    
    fuelSeconds -= (timeDelta * 2); 

    if (fuelSeconds <= 0) {
        fuelSeconds = 0;
        finishFlight();
    }
    
    els.fuelTime.innerText = fuelSeconds.toFixed(2);
    els.fuelBar.style.width = Math.min(100, (fuelSeconds / MAX_FUEL_SEC) * 100) + '%';
    
    updateDistanceDisplay();

    // ★ 今後ここに「はっ」の認識を入れる予定
    // if (volume > threshold + 20) { catchMonster(); }
}

function updateDistanceDisplay() {
    let remain = Math.max(0, goalDistance - totalDistance);
    els.remainDist.innerText = Math.floor(remain).toLocaleString();
    updateMap();
}

// ■ 終了処理
async function finishFlight() {
    currentState = STATE.RESULT;
    document.body.classList.remove('flying');
    els.bg.classList.remove('speed-fast');
    els.bg.classList.add('speed-stop');
    
    els.gameHeader.style.display = 'none';
    
    els.bgm.pause();
    playEngineStallSound();

    try {
        await saveGameData(); 
    } catch (e) {
        console.error("セーブ失敗:", e);
    }

    els.resDist.innerText = Math.floor(flightDistance).toLocaleString(); 
    els.totalDistDisplay.innerText = Math.floor(totalDistance).toLocaleString(); 
    els.modal.classList.remove('hidden');
}

async function saveGameData() {
    const newLog = {
        date: new Date().toISOString(),
        fuelDuration: parseFloat(chargedFuelSeconds.toFixed(2)),
        distance: Math.floor(flightDistance)
    };
    
    if (window.DB && window.DB.save) {
        await window.DB.save(newLog, totalDistance);
    } else {
        console.warn("DB接続がありません。");
    }
}

// ■ その場から再挑戦
function retryGame() {
    els.modal.classList.add('hidden');
    els.gameHeader.style.display = 'flex';
    
    fuelingDone = false;
    hasStartedBlowing = false;
    fuelSeconds = 0;
    chargedFuelSeconds = 0; 
    flightDistance = 0;

    els.fuelTime.innerText = "0.00";
    els.fuelBar.style.width = "0%";
    
    startCountdown();
}

// --- そのほか (変更なし) ---
function updateMap() {
    let progress = totalDistance / goalDistance;
    if (progress > 1) progress = 1;
    els.mapMarker.style.bottom = (progress * 100) + '%';
}
function playBlipSound(freq) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
    gain.gain.setValueAtTime(0.1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.1);
}
function playEngineStallSound() {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, audioContext.currentTime + 0.8);
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.8);
}
let monsters = [];
function spawnFlyingMonsters() {
    const interval = setInterval(() => {
        if (currentState !== STATE.FLYING) { clearInterval(interval); return; }
        const m = document.createElement('img');
        const types = ['./nightgame/blue.png', './nightgame/red.png', './nightgame/yellow.png'];
        m.src = types[Math.floor(Math.random() * 3)];
        m.className = 'floater flying-monster';
        m.style.left = Math.random() * 80 + 10 + '%';
        m.style.top = '-50px';
        m.style.width = '40px';
        m.style.transition = 'top 3s linear, transform 0.5s ease'; 
        els.gameLayer.appendChild(m);
        requestAnimationFrame(() => { m.style.top = '120%'; });
        monsters.push(m);
        setTimeout(() => { if(m.parentNode) m.remove(); monsters = monsters.filter(item => item !== m); }, 3000);
    }, 800);
}
function catchMonster() {
    const catchRange = 300;
    const rocketRect = els.rocket.getBoundingClientRect();
    const rCx = rocketRect.left + rocketRect.width/2;
    const rCy = rocketRect.top + rocketRect.height/2;
    monsters.forEach(m => {
        if(m.caught) return;
        const mRect = m.getBoundingClientRect();
        const mCx = mRect.left + mRect.width/2;
        const mCy = mRect.top + mRect.height/2;
        if (Math.hypot(rCx - mCx, rCy - mCy) < catchRange) {
            m.caught = true;
            m.style.left = rocketRect.left + 20 + 'px';
            m.style.top = rocketRect.top + 30 + 'px';
            m.style.opacity = 0;
            m.style.transform = 'scale(0.1)';
        }
    });
}