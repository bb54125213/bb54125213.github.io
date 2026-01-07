import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// index.htmlと同じConfig
const firebaseConfig = {
    // ... index.html と同じ内容を貼り付け ...
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// データをロード
export async function loadUserData(uid, stageNum) {
    const docRef = doc(db, "users", uid, "stages", `stage_${stageNum}`);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return docSnap.data().totalDistance || 0;
    } else {
        return 0;
    }
}

// データをセーブ (ログ追記 + 現在地更新)
export async function saveUserData(uid, stageNum, logData, totalDistance) {
    const userRef = doc(db, "users", uid);
    const stageRef = doc(db, "users", uid, "stages", `stage_${stageNum}`);

    // ユーザー基本情報更新（初回なら作成）
    await setDoc(userRef, { lastLogin: new Date().toISOString() }, { merge: true });

    // ログデータ保存（サブコレクション logs に追加）
    // firestoreの構造: users/{uid}/stages/stage_1/logs/{autoId}
    // 単純化のため、ステージドキュメント内の配列にログを追加します
    
    await setDoc(stageRef, {
        totalDistance: totalDistance,
        history: arrayUnion(logData) // 配列に追記
    }, { merge: true });
    
    console.log("Cloud Save Complete!");
}