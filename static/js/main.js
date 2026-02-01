/**
 * 1. 動画の同期再生設定
 */
function initVideoSync() {
    document.querySelectorAll('.comparison-container').forEach(container => {
        const v1 = container.querySelector('.video-1');
        const v2 = container.querySelector('.video-2');
        if (v1 && v2) {
            v1.addEventListener('play', () => v2.play());
            v1.addEventListener('pause', () => v2.pause());
            v1.addEventListener('seeking', () => { v2.currentTime = v1.currentTime; });
            v1.addEventListener('ratechange', () => { v2.playbackRate = v1.playbackRate; });
        }
    });
}

/**
 * 2. Ajaxによるいいね
 */
async function toggleLike(postId) {
    const csrfToken = document.querySelector('#csrf_token')?.value;
    const response = await fetch(`/like/${postId}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': csrfToken || '' }
    });
    if (response.ok) {
        const data = await response.json();
        const btnIcon = document.querySelector(`#like-btn-${postId} i`);
        const countSpan = document.querySelector(`#like-count-${postId}`);
        if (data.liked) { btnIcon.classList.replace('fa-regular', 'fa-solid'); btnIcon.classList.add('text-danger'); }
        else { btnIcon.classList.replace('fa-solid', 'fa-regular'); btnIcon.classList.remove('text-danger'); }
        countSpan.innerText = data.count;
    }
}

/**
 * 3. AI 姿勢解析 (数値表示オフ・マーカー表示のみ)
 */
let aiActive = false;
let isAnalyzed = false;
let poseData1 = []; 
let poseData2 = [];
let currentResults = null;
let animationId = null;

function getDataIndexAtTime(data, time) {
    if (!data || data.length === 0) return -1;
    return data.findIndex(d => d.time >= time);
}

async function initPoseDetection() {
    const v1 = document.getElementById('video1');
    const v2 = document.getElementById('video2');
    const c1 = document.getElementById('canvas1');
    const c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI');
    const resetBtn = document.getElementById('resetAI');
    if (!v1 || !c1 || !toggleBtn) return;

    const ctx1 = c1.getContext('2d');
    const ctx2 = c2 ? c2.getContext('2d') : null;

    const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    pose.onResults((results) => { currentResults = results; });

    if (resetBtn) {
        resetBtn.addEventListener('click', () => { if (confirm("Reset analysis data?")) clearAllAnalysis(); });
    }

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay').classList.remove('d-none');
            if (v1.readyState < 2) await new Promise(r => v1.onloadeddata = r);
            poseData1 = await analyzeVideo(v1, pose, v2 ? "Video 1" : "Video");
            if (v2) {
                await new Promise(r => setTimeout(r, 500));
                if (v2.readyState < 2) await new Promise(r => v2.onloadeddata = r);
                poseData2 = await analyzeVideo(v2, pose, "Video 2");
            }
            isAnalyzed = true;
            toggleBtn.disabled = false;
            if (resetBtn) resetBtn.classList.remove('d-none');
            
            // 解析完了後は進捗コンテナを隠し、オーバーレイ自体を非表示にする（マーカーのみ見せるため）
            document.getElementById('analysis-progress-container').classList.add('d-none');
            document.getElementById('stats-overlay').classList.add('d-none');
            
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Show Pose';
        }
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning');
        toggleBtn.classList.toggle('btn-success');
        if (aiActive) renderLoop();
    });

    async function analyzeVideo(video, poseInstance, label) {
        const data = [];
        const duration = video.duration;
        const step = 0.1;
        const originalTime = video.currentTime;
        for (let t = 0; t <= duration; t += step) {
            video.currentTime = t;
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 2000);
                const onSeeked = () => { video.removeEventListener('seeked', onSeeked); clearTimeout(timer); resolve(); };
                video.addEventListener('seeked', onSeeked);
            });
            currentResults = null;
            await poseInstance.send({image: video});
            let poll = 0;
            while (currentResults === null && poll < 50) {
                await new Promise(r => setTimeout(r, 40));
                poll++;
            }
            if (currentResults && currentResults.poseLandmarks) {
                data.push({ time: t, landmarks: JSON.parse(JSON.stringify(currentResults.poseLandmarks)) });
            }
            const progress = Math.round((t / duration) * 100);
            document.getElementById('progress-label').innerText = `${label}: ${t.toFixed(1)}s`;
            document.getElementById('analysis-progress-bar').style.width = `${progress}%`;
            document.getElementById('progress-percent').innerText = `${progress}%`;
        }
        video.currentTime = originalTime;
        return data;
    }

    function renderLoop() {
        if (!aiActive) return;
        const idx = getDataIndexAtTime(poseData1, v1.currentTime);
        if (idx !== -1) {
            const l1 = poseData1[idx].landmarks;
            drawOnCanvas(c1, ctx1, l1);
            if (v2 && ctx2 && poseData2[idx]) {
                const l2 = poseData2[idx].landmarks;
                drawOnCanvas(c2, ctx2, l2);
            }
        }
        animationId = requestAnimationFrame(renderLoop);
    }

    function drawOnCanvas(canvas, ctx, landmarks) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (landmarks) {
            drawConnectors(ctx, landmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
            drawLandmarks(ctx, landmarks, {color: '#FF0000', lineWidth: 1, radius: 2});
        }
    }
}

function clearAllAnalysis() {
    aiActive = false; isAnalyzed = false; poseData1 = []; poseData2 = [];
    if (animationId) cancelAnimationFrame(animationId);
    document.getElementById('toggleAI').innerHTML = '<i class="fa-solid fa-bolt"></i> AI Analyze';
    document.getElementById('stats-overlay').classList.add('d-none');
    const c1 = document.getElementById('canvas1'); const c2 = document.getElementById('canvas2');
    if (c1) c1.getContext('2d').clearRect(0, 0, c1.width, c1.height);
    if (c2) c2.getContext('2d').clearRect(0, 0, c2.width, c2.height);
}

window.addEventListener('pagehide', clearAllAnalysis);
document.addEventListener('DOMContentLoaded', () => {
    initVideoSync();
    initPoseDetection();
});
