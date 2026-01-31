/**
 * 1. 動画の同期再生設定 (比較モード用)
 */
function initVideoSync() {
    document.querySelectorAll('.comparison-container').forEach(container => {
        const v1 = container.querySelector('.video-1');
        const v2 = container.querySelector('.video-2');

        if (v1 && v2) {
            // v1 (左) をマスターとして同期
            v1.addEventListener('play', () => v2.play());
            v1.addEventListener('pause', () => v2.pause());
            v1.addEventListener('seeking', () => { v2.currentTime = v1.currentTime; });
            v1.addEventListener('ratechange', () => { v2.playbackRate = v1.playbackRate; });
        }
    });
}

/**
 * 2. Ajaxによるいいね機能
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
        
        if (data.liked) {
            btnIcon.classList.replace('fa-regular', 'fa-solid');
            btnIcon.classList.add('text-danger');
        } else {
            btnIcon.classList.replace('fa-solid', 'fa-regular');
            btnIcon.classList.remove('text-danger');
        }
        countSpan.innerText = data.count;
    }
}

/**
 * 3. AI姿勢解析 (MediaPipe Pose)
 */
let aiActive = false;
let pose1, pose2;

function initPoseDetection() {
    const video1 = document.getElementById('video1');
    const canvas1 = document.getElementById('canvas1');
    if (!video1 || !canvas1) return;

    const ctx1 = canvas1.getContext('2d');
    const video2 = document.getElementById('video2');
    const canvas2 = document.getElementById('canvas2');

    const toggleBtn = document.getElementById('toggleAI');

    // MediaPipe 設定
    const poseOptions = {
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    };

    // Poseインスタンス作成
    pose1 = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
    pose1.setOptions(poseOptions);
    pose1.onResults((results) => drawPose(results, canvas1, ctx1));

    if (video2 && canvas2) {
        const ctx2 = canvas2.getContext('2d');
        pose2 = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
        pose2.setOptions(poseOptions);
        pose2.onResults((results) => drawPose(results, canvas2, ctx2));
    }

    // ボタンイベント
    toggleBtn.addEventListener('click', () => {
        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-warning');
        toggleBtn.classList.toggle('btn-danger');
        toggleBtn.innerHTML = aiActive ? 
            '<i class="fa-solid fa-stop"></i> AI Stop' : 
            '<i class="fa-solid fa-person-running"></i> AI Analyze ON';
        
        if (!aiActive) {
            // OFF時にキャンバスをクリア
            ctx1.clearRect(0, 0, canvas1.width, canvas1.height);
            if (canvas2) canvas2.getContext('2d').clearRect(0, 0, canvas2.width, canvas2.height);
        } else {
            detectionLoop();
        }
    });

    // 解析ループ
    async function detectionLoop() {
        if (!aiActive) return;
        
        if (!video1.paused && !video1.ended) {
            await pose1.send({image: video1});
        }
        if (video2 && !video2.paused && !video2.ended) {
            await pose2.send({image: video2});
        }
        requestAnimationFrame(detectionLoop);
    }
}

// 骨格の描画
function drawPose(results, canvas, ctx) {
    if (!aiActive) return;
    
    // キャンバスサイズを実際の表示サイズに合わせる
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.poseLandmarks) {
        // 線の描画
        drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 2});
        // 点の描画
        drawLandmarks(ctx, results.poseLandmarks, {color: '#FF0000', lineWidth: 1, radius: 3});
    }
    ctx.restore();
}

// 初期化実行
document.addEventListener('DOMContentLoaded', () => {
    initVideoSync();
    initPoseDetection();
});
