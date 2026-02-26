/**
 * TsuguLog: 製造技術承継プラットフォーム 
 * AI解析ロジック - リセット機能完全修正版
 */

import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

// モジュールレベルの変数管理
if (!window.poseLandmarker) window.poseLandmarker = undefined;
let aiActive = false;
let isAnalyzed = false;
let animationId = null;
let cumulativeMs = 0; // MediaPipeの連続性を保つためリセットしない
let poseData1 = [];
let poseData2 = [];

const LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
    "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
    "left_heel", "right_heel", "left_foot_index", "right_foot_index"
];

// 正規化計算
const calcDist = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
function getNormalizedPose(landmarks) {
    if (!landmarks || landmarks.length < 25) return landmarks;
    const center = {
        x: (landmarks[11].x + landmarks[12].x + landmarks[23].x + landmarks[24].x) / 4,
        y: (landmarks[11].y + landmarks[12].y + landmarks[23].y + landmarks[24].y) / 4
    };
    const scale = (calcDist(landmarks[11], landmarks[23]) + calcDist(landmarks[12], landmarks[24])) / 2 || 1;
    return landmarks.map(p => ({ x: (p.x - center.x) / scale, y: (p.y - center.y) / scale, z: p.z / scale }));
}

/**
 * 【重要】リセット機能の完全版
 */
window.clearAllAnalysis = function() {
    console.log("Resetting AI Analysis...");
    
    // 1. アニメーションループを完全に停止
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    // 2. 状態フラグと解析データの初期化
    aiActive = false;
    isAnalyzed = false;
    poseData1 = [];
    poseData2 = [];

    // 3. UI要素の完全な初期化
    const toggleBtn = document.getElementById('toggleAI');
    const resetBtn = document.getElementById('resetAI');
    const statsOverlay = document.getElementById('stats-overlay');
    const overallCard = document.getElementById('overall-dtw-card');
    const downloadArea = document.getElementById('download-area');
    const progressBar = document.getElementById('analysis-progress-bar');
    const progressPercent = document.getElementById('progress-percent');

    if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.className = "btn btn-sm btn-warning shadow";
        toggleBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> AI解析 実行';
    }
    if (resetBtn) resetBtn.classList.add('d-none');
    if (statsOverlay) statsOverlay.classList.add('d-none');
    if (overallCard) overallCard.classList.add('d-none');
    if (downloadArea) {
        downloadArea.classList.add('d-none');
        document.getElementById('downloadCSV2')?.classList.add('d-none');
    }
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.innerText = '0%';

    // 4. キャンバスの描画内容を消去
    ['canvas1', 'canvas2'].forEach(id => {
        const c = document.getElementById(id);
        if (c) {
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, c.width, c.height);
        }
    });
};

async function initPoseDetection() {
    const v1 = document.getElementById('video1'), c1 = document.getElementById('canvas1');
    const v2 = document.getElementById('video2'), c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI'), resetBtn = document.getElementById('resetAI');

    if (!v1 || !toggleBtn) return;

    // MediaPipe初期化
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    window.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`, delegate: "GPU" },
        runningMode: "VIDEO", numPoses: 2
    });

    // リセットボタンにイベントを登録
    resetBtn?.addEventListener('click', () => {
        if (confirm("解析データを破棄してリセットしますか？")) {
            window.clearAllAnalysis();
        }
    });

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            if (!window.poseLandmarker) return alert("AIエンジンの準備を待っています...");

            toggleBtn.disabled = true;
            document.getElementById('stats-overlay')?.classList.remove('d-none');
            document.getElementById('analysis-progress-container')?.classList.remove('d-none');
            const pPerc = document.getElementById('progress-percent'), pBar = document.getElementById('analysis-progress-bar');

            // --- 動画1解析 (比較用動画があれば1人抽出、なければ全員) ---
            poseData1 = await analyzeVideo(v1, "動画1", pPerc, pBar, v2 !== null);
            
            // --- 動画2解析 (存在する場合) ---
            if (v2) {
                if (isNaN(v2.duration)) await new Promise(r => v2.onloadedmetadata = r);
                poseData2 = await analyzeVideo(v2, "動画2", pPerc, pBar, true);
                document.getElementById('downloadCSV2')?.classList.remove('d-none');
            }

            // 採点実行 (1動画内2人 または 2動画間比較)
            await runComparisonScoring(poseData1, poseData2);

            isAnalyzed = true;
            toggleBtn.disabled = false;
            resetBtn?.classList.remove('d-none');
            document.getElementById('download-area')?.classList.remove('d-none');
            document.getElementById('stats-overlay')?.classList.add('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> 解析表示 ON';
        }

        // 表示の切り替え
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning');
        toggleBtn.classList.toggle('btn-success');
        
        if (aiActive) {
            renderLoop();
        } else {
            if (animationId) cancelAnimationFrame(animationId);
        }
    });

    async function analyzeVideo(video, label, percentEl, barEl, limitToOne) {
        const data = [], step = 0.1, duration = video.duration;
        const originalTime = video.currentTime;
        video.pause();
        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            await new Promise(r => { video.onseeked = r; setTimeout(r, 1000); });
            
            const prog = Math.min(100, Math.round((t / duration) * 100));
            if (percentEl) percentEl.innerText = `${label}: ${prog}%`;
            if (barEl) barEl.style.width = `${prog}%`;

            const res = window.poseLandmarker.detectForVideo(video, cumulativeMs);
            cumulativeMs += 100;

            if (res.landmarks) {
                let poses = JSON.parse(JSON.stringify(res.landmarks));
                if (limitToOne) poses = poses.slice(0, 1);
                data.push({ 
                    time: t.toFixed(2), 
                    poses: poses,
                    normPoses: poses.map(l => getNormalizedPose(l)) 
                });
            }
        }
        video.currentTime = originalTime;
        return data;
    }

    async function runComparisonScoring(d1, d2) {
        const payload = { normPoseData: d1.map(d => ({time: d.time, poses: d.normPoses})) };
        if (d2 && d2.length > 0) {
            payload.poseData1 = payload.normPoseData;
            payload.poseData2 = d2.map(d => ({time: d.time, poses: d.normPoses}));
        }

        const res = await fetch('/analyze/dtw', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': document.getElementById('csrf_token').value},
            body: JSON.stringify(payload)
        }).then(r => r.json());

        if (res.dtw_score !== undefined) {
            document.getElementById('overall-dtw-card')?.classList.remove('d-none');
            document.getElementById('dtw-score-val').innerText = res.dtw_score;
            document.getElementById('dtw-score-bar').style.width = `${res.dtw_score}%`;
            document.getElementById('avg-cosine-val').innerText = res.avg_cosine.toFixed(4);
            document.getElementById('avg-euclidean-val').innerText = res.avg_euclidean.toFixed(4);
            const bar = document.getElementById('dtw-score-bar');
            bar.className = `progress-bar ${res.dtw_score > 80 ? 'bg-success' : (res.dtw_score > 50 ? 'bg-warning' : 'bg-danger')}`;
        }
    }

    function renderLoop() {
        if (!aiActive) return;
        const curr = v1.currentTime;
        const f1 = poseData1.find(d => d.time >= curr);
        if (f1) drawPoses(c1, f1.poses);
        
        if (v2 && c2 && poseData2.length > 0) {
            const f2 = poseData2.find(d => d.time >= curr);
            if (f2) drawPoses(c2, f2.poses);
        }
        animationId = requestAnimationFrame(renderLoop);
    }

    function drawPoses(canvas, poses) {
        if (!canvas || !poses) return;
        canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
        const ctx = canvas.getContext('2d'), du = new DrawingUtils(ctx);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        poses.forEach((lm, i) => {
            du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {color: i===0?'#00FF00':'#00BFFF', lineWidth: 2});
            du.drawLandmarks(lm, {color: '#FF0000', radius: 2});
        });
    }
}

/** CSV保存用 **/
function downloadAsCSV(data, filename) {
    if (!data || data.length === 0) return;
    let csv = "timestamp_sec,person_id,landmark_id,landmark_name,x,y,z\n";
    data.forEach(frame => frame.poses.forEach((pose, pIdx) => pose.forEach((lm, lmIdx) => {
        csv += `${frame.time},${pIdx},${lmIdx},${LANDMARK_NAMES[lmIdx]},${lm.x.toFixed(6)},${lm.y.toFixed(6)},${lm.z.toFixed(6)}\n`;
    })));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = filename; link.click();
}

window.addEventListener('pagehide', window.clearAllAnalysis);
document.addEventListener('DOMContentLoaded', () => {
    initPoseDetection();
    document.querySelectorAll('.comparison-container').forEach(container => {
        const v1 = container.querySelector('.video-1'), v2 = container.querySelector('.video-2');
        if (v1 && v2) {
            v1.addEventListener('play', () => v2.play().catch(()=>{}));
            v1.addEventListener('pause', () => v2.pause());
            v1.addEventListener('seeking', () => v2.currentTime = v1.currentTime);
        }
    });
});
