// --- 設定データ ---
const STAGE_DATA = {
    1: { distance: 100000000, name: "惑星インハレスへの旅路" },
    2: { distance: 150000000, name: "惑星エクセールへ" },
    3: { distance: 300000000, name: "惑星プネウマへ" }
};

const STATE = {
    INIT: 0,
    WAIT_DB: 0.5,
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

let currentStageNum = 1;
let goalDistance = 100000000;
let currentCostId = null; 

let fuelSeconds = 0;       
let chargedFuelSeconds = 0; 
let flightDistance = 0;    
let totalDistance = 0;     
// 1秒の燃料で何キロ進むか
const FLIGHT_SPEED = 500000;
// 燃料タンクの表示できる最大値
const MAX_FUEL_SEC = 20;
// 1秒の燃料で飛ぶアニメーション時間の倍率
const FLIGHT_ANIMATION_TIME_MULTIPLIER = 2;

let hasStartedBlowing = false; 
let fuelingDone = false;       

// 音声認識設定 (Load Config)
const THOUSAND_INDEX = 24;
// デフォルト値
let micConfig = {
    noiseThreshold: 0.05, 
    paProfile: [0.032, 0.041, 0.014, 0.022, 0.009, 0.017, 0.005, 0.022, 0.011, 0.010, 0.029, 0.092, 0.135, 0.139, 0.051, 0.013, 0.009, 0.012, 0.014, 0.014, 0.008, 0.009, 0.017, 0.007]
};

// コックピット設定の読み込み
const savedConfig = localStorage.getItem('mic_config_v2');
if(savedConfig) {
    try {
        micConfig = JSON.parse(savedConfig);
        console.log("Cockpit Config Loaded:", micConfig);
    } catch(e) { console.error("Config Error"); }
}

const els = {
    bg: document.getElementById('gameBg'),
    rocket: document.getElementById('rocket'),
    msgArea: document.getElementById('messageArea'),
    fuelTime: document.getElementById('fuelTime'),
    fuelBar: document.getElementById('fuelBar'),
    remainDist: document.getElementById('remainDist'),
    micLevel: document.getElementById('micLevel'),
    paBtn: document.getElementById('paBtn'),
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
    retryBtn: document.getElementById('retryBtn')
};

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const stageParam = urlParams.get('stage');
    currentCostId = urlParams.get('cost');

    if (stageParam && STAGE_DATA[stageParam]) {
        currentStageNum = parseInt(stageParam);
    }
    goalDistance = STAGE_DATA[currentStageNum].distance;
    els.stageNameDisplay.innerText = STAGE_DATA[currentStageNum].name;

    consumeMonsterAndLoad(currentCostId);
});

async function consumeMonsterAndLoad(costId) {
    currentState = STATE.WAIT_DB;
    
    if (window.DB && window.DB.load && window.DB.consumeAndStart) {
        totalDistance = await window.DB.load();
        updateDistanceDisplay();

        if(costId && !window.isRetry) {
            await window.DB.consumeAndStart(costId);
        } else if(window.isRetry) {
            window.readyToStart = true;
        } else {
            window.readyToStart = true;
        }

        if(window.readyToStart) {
            els.msgArea.innerHTML = '<p>エネルギー充填完了！<br>準備完了を押してください</p><button onclick="initGame()" class="pixel-btn start-btn">準備完了</button>';
            currentState = STATE.INIT;
        }
    }
}

window.tryRetry = async function() {
    els.retryBtn.disabled = true;
    els.retryBtn.innerText = "確認中...";

    if(window.DB.checkInventory) {
        const hasStock = await window.DB.checkInventory(currentCostId);
        if(!hasStock) {
            alert("モンスターがいません！惑星に戻って捕獲してください。");
            location.href = "stage_select.html";
            return;
        }
    }

    if(window.DB.consumeAndStart) {
        const success = await window.DB.consumeAndStart(currentCostId);
        if(!success) {
            alert("通信エラーが発生しました");
            return;
        }
    }

    window.isRetry = true; 
    els.modal.classList.add('hidden');
    els.gameHeader.style.display = 'flex';
    
    fuelingDone = false;
    hasStartedBlowing = false;
    fuelSeconds = 0;
    chargedFuelSeconds = 0; 
    flightDistance = 0;
    els.retryBtn.disabled = false;
    els.retryBtn.innerText = "力を借りて再出発";

    els.fuelTime.innerText = "0.00";
    els.fuelBar.style.width = "0%";
    
    els.bg.classList.remove('speed-stop');
    startCountdown();
};

async function initGame() {
    try {
        // 余計なオプションを削除し、最も安定する設定に戻しました
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
    let max_amplitude = 0;
    for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
    let average = sum / dataArray.length;
    
    for(let i=0; i<THOUSAND_INDEX; i++) {
        const val = dataArray[i] / 255.0;
        if(val > max_amplitude) max_amplitude = val;
    }

    let highFreqEnergy = 0;
    for(let i=30; i<100; i++) highFreqEnergy += dataArray[i];
    const highFreqAvg = highFreqEnergy / 70;

    let visualLevel = Math.min(100, (max_amplitude / micConfig.noiseThreshold) * 30); 
    els.micLevel.style.width = visualLevel + '%';
    
    const isOverThreshold = max_amplitude > micConfig.noiseThreshold;
    els.micLevel.style.backgroundColor = isOverThreshold ? '#2ecc71' : '#555';

    if (currentState === STATE.FUELING) {
        const isBlowing = isOverThreshold && (highFreqAvg > 10);
        processFueling(isBlowing);
    } else if (currentState === STATE.FLYING) {
        processFlying();
        // 飛行中も監視したい場合はここにanalyzeVoiceなどを入れる
    }
    requestAnimationFrame(gameLoop);
}

function analyzeVoice(maxAmp) {
    if (maxAmp < micConfig.noiseThreshold) return null;

    let Pa_euclid = 0;
    for (let i = 0; i < THOUSAND_INDEX; i++) {
        const spectrumVal = dataArray[i] / 255.0; 
        Pa_euclid += Math.pow(micConfig.paProfile[i] - spectrumVal, 2);
    }
    const Pa_odds = 1 / (1 + Math.sqrt(Pa_euclid));
    
    if (Pa_odds >= 0.70) return "ぱっ";
    return null;
}

function processFueling(isBlowing) {
    if (fuelingDone) {
        let maxAmp = 0;
        for(let i=0; i<THOUSAND_INDEX; i++) if(dataArray[i]/255.0 > maxAmp) maxAmp = dataArray[i]/255.0;
        
        const recognized = analyzeVoice(maxAmp);
        if (recognized === "ぱっ") {
            launchRocket();
        }
        return;
    }

    if (isBlowing) {
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
    els.paBtn.innerText = "航行中...";
    els.paBtn.style.backgroundColor = "#2980b9";
    els.paBtn.onclick = null; 
    els.bg.classList.remove('speed-stop');
    els.bg.classList.add('speed-fast');
    document.body.classList.add('flying');
}

function processFlying() {
    const timeDelta = 1 / 60;
    const distDelta = (FLIGHT_SPEED / FLIGHT_ANIMATION_TIME_MULTIPLIER) * timeDelta;
    flightDistance += distDelta;   
    totalDistance += distDelta;
    
    fuelSeconds -= (timeDelta / FLIGHT_ANIMATION_TIME_MULTIPLIER);

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
    } catch (e) { console.error(e); }

    if (window.DB && window.DB.getInventoryCount && currentCostId) {
        const count = await window.DB.getInventoryCount(currentCostId);
        const stockEl = document.getElementById('currentStock');
        if(stockEl) stockEl.innerText = count;
        
        if(count < 1) {
            els.retryBtn.disabled = true;
            els.retryBtn.innerText = "所持なし";
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