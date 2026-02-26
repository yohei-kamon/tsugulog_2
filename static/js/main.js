/**
 * TsuguLog: 高精度・低負荷同期エンジン
 */
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

if (!window.poseLandmarker) window.poseLandmarker = undefined;
let aiActive = false, isAnalyzed = false, animationId = null, cumulativeMs = 0;
let poseData1 = [], poseData2 = [];

const LANDMARK_NAMES = ["nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index"];

/** 1. 補間ロジック (タイミング調整の要) **/
function getInterpolatedPose(data, time) {
    if (!data || data.length === 0) return null;
    let nextIdx = data.findIndex(d => d.time > time);
    if (nextIdx === 0) return data[0].poses;
    if (nextIdx === -1) return data[data.length - 1].poses;

    const prev = data[nextIdx - 1], next = data[nextIdx];
    const ratio = (time - prev.time) / (next.time - prev.time);

    return prev.poses.map((pose, pIdx) => {
        const nPose = next.poses[pIdx];
        if (!nPose) return pose;
        return pose.map((lm, i) => ({
            x: lm.x + (nPose[i].x - lm.x) * ratio,
            y: lm.y + (nPose[i].y - lm.y) * ratio,
            z: lm.z + (nPose[i].z - lm.z) * ratio,
            visibility: lm.visibility
        }));
    });
}

/** 2. 正規化 (計算用) **/
function getNormalizedPose(l) {
    if (!l || l.length < 25) return l;
    const c = { x: (l[11].x + l[12].x + l[23].x + l[24].x) / 4, y: (l[11].y + l[12].y + l[23].y + l[24].y) / 4 };
    const s = (Math.sqrt((l[11].x-l[23].x)**2 + (l[11].y-l[23].y)**2) + Math.sqrt((l[12].x-l[24].x)**2 + (l[12].y-l[24].y)**2)) / 2 || 1;
    return l.map(p => ({ x: (p.x - c.x) / s, y: (p.y - c.y) / s, z: p.z / s }));
}

/** 3. リセット **/
window.clearAllAnalysis = function() {
    if (animationId) cancelAnimationFrame(animationId);
    aiActive = false; isAnalyzed = false; poseData1 = []; poseData2 = [];
    document.getElementById('toggleAI').className = "btn btn-xs btn-warning py-0 px-2 fw-bold";
    document.getElementById('toggleAI').innerHTML = "AI解析 実行";
    document.getElementById('resetAI')?.classList.add('d-none');
    document.getElementById('overall-dtw-card')?.classList.add('d-none');
    document.getElementById('download-area')?.classList.add('d-none');
    ['canvas1', 'canvas2'].forEach(id => {
        const c = document.getElementById(id);
        if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    });
};

/** 4. 解析エンジン **/
async function initPoseDetection() {
    const v1 = document.getElementById('video1'), c1 = document.getElementById('canvas1');
    const v2 = document.getElementById('video2'), c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI');

    if (!v1 || !toggleBtn) return;

    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    window.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`, delegate: "GPU" },
        runningMode: "VIDEO", numPoses: 2
    });

    document.getElementById('downloadCSV1')?.addEventListener('click', () => downloadAsCSV(poseData1, "data.csv"));
    document.getElementById('recordVideoBtn')?.addEventListener('click', () => startLiveExport(v1, c1, v2, c2));

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay').classList.remove('d-none');
            poseData1 = await analyzeVideo(v1, "動画1");
            if (v2) poseData2 = await analyzeVideo(v2, "動画2");
            else if (poseData1.length > 0 && poseData1[0].poses.length >= 2) await runDtw(poseData1, null);

            isAnalyzed = true; toggleBtn.disabled = false;
            document.getElementById('resetAI')?.classList.remove('d-none');
            document.getElementById('download-area')?.classList.remove('d-none');
            document.getElementById('stats-overlay').classList.add('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> 表示 ON';
        }
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning'); toggleBtn.classList.toggle('btn-success');
        if (aiActive) renderLoop();
    });

    async function analyzeVideo(video, label) {
        const data = [], step = 0.1, duration = video.duration;
        const originalTime = video.currentTime;
        video.pause();
        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            await new Promise(r => { video.onseeked = r; setTimeout(r, 1000); });
            const prog = Math.min(100, Math.round((t / duration) * 100));
            document.getElementById('progress-percent').innerText = `${label}: ${prog}%`;
            document.getElementById('analysis-progress-bar').style.width = `${prog}%`;

            const res = window.poseLandmarker.detectForVideo(video, cumulativeMs);
            cumulativeMs += 100;
            if (res.landmarks) {
                const poses = JSON.parse(JSON.stringify(res.landmarks));
                data.push({ time: t, poses: poses, normPoses: poses.map(l => getNormalizedPose(l)) });
            }
        }
        video.currentTime = originalTime;
        return data;
    }

    async function runDtw(d1, d2) {
        const body = { normPoseData1: d1.map(d => ({time: d.time, poses: d.normPoses})) };
        if (d2) body.normPoseData2 = d2.map(d => ({time: d.time, poses: d.normPoses}));
        const res = await fetch('/analyze/dtw', {
            method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRFToken': document.getElementById('csrf_token').value},
            body: JSON.stringify(body)
        }).then(r => r.json());

        if (res.dtw_score !== undefined) {
            document.getElementById('overall-dtw-card')?.classList.remove('d-none');
            document.getElementById('dtw-score-val').innerText = res.dtw_score;
            document.getElementById('dtw-score-bar').style.width = `${res.dtw_score}%`;
        }
    }

    function renderLoop() {
        if (!aiActive) return;
        const time = v1.currentTime;
        draw(c1, getInterpolatedPose(poseData1, time));
        if (v2 && c2) draw(c2, getInterpolatedPose(poseData2, time));
        animationId = requestAnimationFrame(renderLoop);
    }

    function draw(canvas, poses) {
        if (!canvas || !poses) return;
        canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
        const ctx = canvas.getContext('2d'), du = new DrawingUtils(ctx);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        poses.forEach((lm, i) => {
            du.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {color: i===0?'#00FF00':'#00BFFF', lineWidth: 4});
            du.drawLandmarks(lm, {color: '#FF0000', radius: 2});
        });
    }
}

/** 5. 【軽量】リアルタイム合成保存 **/
async function startLiveExport(v1, c1, v2, c2) {
    const btn = document.getElementById('recordVideoBtn');
    btn.disabled = true; btn.innerText = "録画中...";
    
    // 合成用キャンバス
    const outC = document.createElement('canvas');
    const ctx = outC.getContext('2d');
    const w = v1.videoWidth, h = v1.videoHeight;
    outC.width = v2 ? w * 2 : w; outC.height = h;

    const stream = outC.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
        link.download = "technical_analysis.webm"; link.click();
        btn.disabled = false; btn.innerText = "解析済み動画を生成・保存";
    };

    recorder.start();
    v1.currentTime = 0; if (v2) v2.currentTime = 0;
    aiActive = true; 
    v1.play(); if (v2) v2.play();

    const interval = setInterval(() => {
        ctx.drawImage(v1, 0, 0, w, h);
        ctx.drawImage(c1, 0, 0, w, h);
        if (v2) {
            ctx.drawImage(v2, w, 0, w, h);
            ctx.drawImage(c2, w, 0, w, h);
        }
        if (v1.ended) { clearInterval(interval); recorder.stop(); }
    }, 33);
}

function downloadAsCSV(data, name) {
    let csv = "time,person,landmark,x,y,z\n";
    data.forEach(f => f.poses.forEach((p, pi) => p.forEach((l, li) => {
        csv += `${f.time},${pi},${LANDMARK_NAMES[li]},${l.x},${l.y},${l.z}\n`;
    })));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    a.download = name; a.click();
}

document.addEventListener('DOMContentLoaded', () => {
    // 同期設定
    document.querySelectorAll('.comparison-container').forEach(cnt => {
        const video1 = cnt.querySelector('.video-1'), video2 = cnt.querySelector('.video-2');
        if (video1 && video2) {
            video1.onplay = () => video2.play();
            video1.onpause = () => video2.pause();
            video1.onseeking = () => video2.currentTime = video1.currentTime;
        }
    });
    initPoseDetection();
});
