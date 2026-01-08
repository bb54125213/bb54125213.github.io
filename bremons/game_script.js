// --- 設定データ ---
const STAGE_DATA = {
    1: { distance: 100000000, name: "惑星インハレスへの旅路" },
    2: { distance: 150000000, name: "惑星エクセールへ" },
    3: { distance: 300000000, name: "惑星プネウマへ" }
};

// ゲームの状態管理
const STATE = {
    INIT: 0,
    WAIT_DB: 0.5, // DB処理待ち
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
let currentCostId = null; // ★追加: 消費するモンスターIDを記憶

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

// 音声認識用データ (Paのみ)
const THOUSAND_INDEX = 24;
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
    pauseModal: document.getElementById('pauseModal'),
    retryBtn: document.getElementById('retryBtn') // ★追加
};

// ■ 初期化
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const stageParam = urlParams.get('stage');
    currentCostId = urlParams.get('cost'); // モンスターID

    if (stageParam && STAGE_DATA[stageParam]) {
        currentStageNum = parseInt(stageParam);
    }
    goalDistance = STAGE_DATA[currentStageNum].distance;

    els.stageNameDisplay.innerText = STAGE_DATA[currentStageNum].name;

    els.sensitivity.addEventListener('input', () => {
         els.threshVal.innerText = els.sensitivity.value;
    });

    consumeMonsterAndLoad(currentCostId);
});

async function consumeMonsterAndLoad(costId) {
    currentState = STATE.WAIT_DB;
    
    if (window.DB && window.DB.load && window.DB.consumeAndStart) {
        // 1. 距離ロード
        totalDistance = await window.DB.load();
        updateDistanceDisplay();

        // 2. モンスター消費 (初回)
        if(costId && !window.isRetry) {
            await window.DB.consumeAndStart(costId);
        } else if(window.isRetry) {
            // リトライ時は既にconsumeAndStartを呼んでいるのでスキップ（フラグだけ立てる）
            window.readyToStart = true;
        } else {
            // テスト用
            window.readyToStart = true;
        }

        // 3. 準備完了ボタン表示
        if(window.readyToStart) {
            els.msgArea.innerHTML = '<p>エネルギー充填完了！<br>準備完了を押してください</p><button onclick="initGame()" class="pixel-btn start-btn">準備完了</button>';
            currentState = STATE.INIT;
        }
    }
}

// ■ その場から再挑戦（リトライボタン）
window.tryRetry = async function() {
    els.retryBtn.disabled = true;
    els.retryBtn.innerText = "確認中...";

    // 在庫チェック
    if(window.DB.checkInventory) {
        const hasStock = await window.DB.checkInventory(currentCostId);
        if(!hasStock) {
            alert("モンスターの在庫がありません！惑星に戻って捕獲してください。");
            location.href = "stage_select.html";
            return;
        }
    }

    // 消費実行
    if(window.DB.consumeAndStart) {
        const success = await window.DB.consumeAndStart(currentCostId);
        if(!success) {
            alert("通信エラーが発生しました");
            return;
        }
    }

    // リトライ処理開始
    els.modal.classList.add('hidden');
    els.gameHeader.style.display = 'flex';
    
    // 変数リセット
    fuelingDone = false;
    hasStartedBlowing = false;
    fuelSeconds = 0;
    chargedFuelSeconds = 0; 
    flightDistance = 0;
    els.retryBtn.disabled = false;
    els.retryBtn.innerText = "モンスター消費して再挑戦";

    els.fuelTime.innerText = "0.00";
    els.fuelBar.style.width = "0%";
    
    // 背景速度戻す
    els.bg.classList.remove('speed-stop');
    
    // カウントダウンへ
    startCountdown();
};

// ... 以下、既存のロジック（変更なし） ...

async function initGame() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
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
            els.paBtn.innerText = "ぱっ！と言って発射"; 
            els.paBtn.disabled = true;
            playBlipSound(1000); 
            gameLoop();
        }
    }, 1000);
}

window.togglePause = function() {
    if (currentState === STATE.PAUSED) {
        currentState = lastState;
        els.pauseModal.classList.add('hidden');
        if (currentState === STATE.FLYING) {
            els.bgm.play();
            els.bg.classList.remove('speed-stop');
        }
    } else {
        if (currentState === STATE.RESULT || currentState === STATE.WAIT_DB) return;
        lastState = currentState;
        currentState = STATE.PAUSED;
        els.pauseModal.classList.remove('hidden');
        els.bgm.pause();
        els.bg.classList.add('speed-stop');
    }
};

function gameLoop() {
    if (currentState === STATE.PAUSED) {
        requestAnimationFrame(gameLoop);
        return;
    }
    if (!isMicActive) return;
    analyser.getByteFrequencyData(dataArray);
    
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

    const recognizedSound = analyzeVoice(dataArray);

    if (currentState === STATE.FUELING) {
        processFueling(average, threshold, isOverThreshold, recognizedSound);
    } else if (currentState === STATE.FLYING) {
        processFlying(average, threshold);
    }
    requestAnimationFrame(gameLoop);
}

function analyzeVoice(data) {
    let max_amplitude = 0;
    let Pa_euclid = 0;
    for (let i = 0; i < THOUSAND_INDEX; i++) {
        const spectrumVal = data[i] / 255.0; 
        if (spectrumVal > max_amplitude) max_amplitude = spectrumVal;
        Pa_euclid += Math.pow(Pa_array[i] - spectrumVal, 2);
    }
    const Pa_odds = 1 / (1 + Math.sqrt(Pa_euclid));
    if (max_amplitude < 0.05) return null;
    if (Pa_odds >= 0.70) return "ぱっ";
    return null;
}

function processFueling(volume, threshold, isOverThreshold, recognizedSound) {
    if (fuelingDone) {
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
            els.paBtn.disabled = false;
            els.paBtn.innerText = "「ぱっ！」と言って発射";
            els.paBtn.style.backgroundColor = "#e74c3c";
            els.paBtn.onclick = launchRocket;
            els.fuelBar.classList.remove('overcharge');
            playBlipSound(800);
        }
    }
}

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
}

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

    // ★追加: 現在の所持数を取得して表示
    if (window.DB && window.DB.getInventoryCount && currentCostId) {
        const count = await window.DB.getInventoryCount(currentCostId);
        const stockEl = document.getElementById('currentStock');
        if(stockEl) stockEl.innerText = count;
        
        // 0匹ならボタン押せないようにする
        if(count < 1) {
            els.retryBtn.disabled = true;
            els.retryBtn.innerText = "在庫なし";
            els.retryBtn.style.backgroundColor = "#555";
        }
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
    }
}

// 変更なし関数群
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