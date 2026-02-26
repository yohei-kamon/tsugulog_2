/**
 * TsuguLog: 製造技術承継プラットフォーム 
 * AI解析 & 2動画個別1人抽出版 (ES Module)
 */

import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

// グローバル状態管理
if (!window.poseLandmarker) window.poseLandmarker = undefined;
let aiActive = false;
let isAnalyzed = false;
let animationId = null;
let cumulativeMs = 0;
let poseData1 = []; 
let poseData2 = [];

const LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
    "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
    "left_heel", "right_heel", "left_foot_index", "right_foot_index"
];

// 正規化計算 (採点用)
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
 * リセット機能
 */
window.clearAllAnalysis = function() {
    if (animationId) cancelAnimationFrame(animationId);
    aiActive = false;
    isAnalyzed = false;
    poseData1 = [];
    poseData2 = [];
    const toggleBtn = document.getElementById('toggleAI');
    const resetBtn = document.getElementById('resetAI');
    const statsOverlay = document.getElementById('stats-overlay');
    const overallCard = document.getElementById('overall-dtw-card');
    const downloadArea = document.getElementById('download-area');

    if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.className = "btn btn-sm btn-warning shadow";
        toggleBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> AI解析 実行';
    }
    if (resetBtn) resetBtn.classList.add('d-none');
    if (statsOverlay) statsOverlay.classList.add('d-none');
    if (overallCard) overallCard.classList.add('d-none');
    if (downloadArea) downloadArea.classList.add('d-none');

    ['canvas1', 'canvas2'].forEach(id => {
        const c = document.getElementById(id);
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    });
};

/**
 * CSVダウンロード
 */
function downloadAsCSV(data, filename) {
    if (!data || data.length === 0) return alert("解析データがありません。");
    let csvContent = "timestamp_sec,person_id,landmark_id,landmark_name,x,y,z\n";
    data.forEach(frame => {
        frame.poses.forEach((pose, pIdx) => {
            pose.forEach((lm, lmIdx) => {
                csvContent += `${frame.time},${pIdx},${lmIdx},${LANDMARK_NAMES[lmIdx]},${lm.x.toFixed(6)},${lm.y.toFixed(6)},${lm.z.toFixed(6)}\n`;
            });
        });
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.setAttribute("download", filename);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

async function initPoseDetection() {
    const v1 = document.getElementById('video1'), c1 = document.getElementById('canvas1');
    const v2 = document.getElementById('video2'), c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI'), resetBtn = document.getElementById('resetAI');

    if (!v1 || !toggleBtn) return;

    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    window.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`, delegate: "GPU" },
        runningMode: "VIDEO", numPoses: 2
    });

    document.getElementById('downloadCSV1')?.addEventListener('click', () => downloadAsCSV(poseData1, "video1_motion.csv"));
    document.getElementById('downloadCSV2')?.addEventListener('click', () => downloadAsCSV(poseData2, "video2_motion.csv"));

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            if (!window.poseLandmarker) return alert("準備中...");
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay').classList.remove('d-none');
            const pPercent = document.getElementById('progress-percent');
            const pBar = document.getElementById('analysis-progress-bar');

            // 動画が2つの場合、それぞれの動画で「1人のみ」を抽出するフラグ
            const onlyOnePerson = v2 !== null;

            poseData1 = await analyzeVideo(v1, "動画1", pPercent, pBar, onlyOnePerson);
            if (v2) {
                if (isNaN(v2.duration)) await new Promise(r => v2.onloadedmetadata = r);
                poseData2 = await analyzeVideo(v2, "動画2", pPercent, pBar, onlyOnePerson);
                document.getElementById('downloadCSV2')?.classList.remove('d-none');
            } else if (poseData1.length > 0 && poseData1[0].poses.length >= 2) {
                await runDtwScoring(poseData1);
            }

            isAnalyzed = true; toggleBtn.disabled = false;
            resetBtn?.classList.remove('d-none');
            document.getElementById('download-area')?.classList.remove('d-none');
            document.getElementById('stats-overlay').classList.add('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> 解析表示 ON';
        }
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning'); toggleBtn.classList.toggle('btn-success');
        if (aiActive) renderLoop();
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
                // ★ 修正ポイント: 比較モード(limitToOne)なら先頭1人のみ保存
                let posesToSave = JSON.parse(JSON.stringify(res.landmarks));
                if (limitToOne) posesToSave = posesToSave.slice(0, 1);

                data.push({ 
                    time: t.toFixed(2), 
                    poses: posesToSave,
                    normPoses: posesToSave.map(l => getNormalizedPose(l)) 
                });
            }
        }
        video.currentTime = originalTime;
        return data;
    }

    async function runDtwScoring(data) {
        const dtwRes = await fetch('/analyze/dtw', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json', 'X-CSRFToken': document.getElementById('csrf_token').value},
            body: JSON.stringify({ normPoseData: data.map(d => ({time: d.time, poses: d.normPoses})) })
        }).then(r => r.json());

        if (dtwRes.dtw_score !== undefined) {
            document.getElementById('overall-dtw-card')?.classList.remove('d-none');
            document.getElementById('dtw-score-val').innerText = dtwRes.dtw_score;
            document.getElementById('dtw-score-bar').style.width = `${dtwRes.dtw_score}%`;
            document.getElementById('avg-cosine-val').innerText = dtwRes.avg_cosine.toFixed(4);
            document.getElementById('avg-euclidean-val').innerText = dtwRes.avg_euclidean.toFixed(4);
        }
    }

    function renderLoop() {
        if (!aiActive) return;
        const curr = v1.currentTime;
        const d1 = poseData1.find(d => d.time >= curr);
        if (d1) drawPoses(c1, d1.poses);
        if (v2 && c2) {
            const d2 = poseData2.find(d => d.time >= curr);
            if (d2) drawPoses(c2, d2.poses);
        }
        animationId = requestAnimationFrame(renderLoop);
    }

    function drawPoses(canvas, poses) {
        if (!canvas || !poses) return;
        canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const du = new DrawingUtils(ctx);
        poses.forEach((lm, i) => {
            du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {color: i===0?'#00FF00':'#00BFFF', lineWidth: 2});
            du.drawLandmarks(lm, {color: '#FF0000', radius: 2});
        });
    }
}

function initVideoSync() {
    document.querySelectorAll('.comparison-container').forEach(container => {
        const video1 = container.querySelector('.video-1'), video2 = container.querySelector('.video-2');
        if (video1 && video2) {
            video1.addEventListener('play', () => video2.play().catch(()=>{}));
            video1.addEventListener('pause', () => video2.pause());
            video1.addEventListener('seeking', () => video2.currentTime = video1.currentTime);
        }
    });
}

window.addEventListener('pagehide', window.clearAllAnalysis);
document.addEventListener('DOMContentLoaded', () => {
    initVideoSync();
    initPoseDetection();
});
