let aiActive = false;
let isAnalyzed = false;
let humanData1 = [];
let humanData2 = [];
let animationId = null;

async function initHumanDetection() {
    const v1 = document.getElementById('video1');
    const v2 = document.getElementById('video2');
    const c1 = document.getElementById('canvas1');
    const c2 = document.getElementById('canvas2');
    const toggleBtn = document.getElementById('toggleAI');
    if (!v1 || !toggleBtn) return;

    toggleBtn.addEventListener('click', async () => {
        if (!isAnalyzed) {
            toggleBtn.disabled = true;
            document.getElementById('stats-overlay')?.classList.remove('d-none');
            const postId = window.location.pathname.split('/').pop();

            // サーバー側で人間抽出解析を実行
            const res1 = await fetch(`/analyze_human/${postId}/1`);
            humanData1 = await res1.json();
            if (v2) {
                const res2 = await fetch(`/analyze_human/${postId}/2`);
                humanData2 = await res2.json();
            }

            isAnalyzed = true;
            toggleBtn.disabled = false;
            document.getElementById('loading-msg')?.classList.add('d-none');
            document.getElementById('stats-data')?.classList.remove('d-none');
            toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Sync Human';
        }

        aiActive = !aiActive;
        toggleBtn.classList.toggle('btn-info');
        toggleBtn.classList.toggle('btn-success');
        if (aiActive) renderLoop();
    });

    function renderLoop() {
        if (!aiActive) return;
        
        const f1 = humanData1.find(d => d.time >= v1.currentTime) || humanData1[0];
        drawHumanRect(c1, c1.getContext('2d'), f1, '#00D1FF');

        if (v2 && c2) {
            const f2 = humanData2.find(d => d.time >= v2.currentTime) || humanData2[0];
            compareHumanMovement(f1, f2, c2, c2.getContext('2d'));
        }
        animationId = requestAnimationFrame(renderLoop);
    }

    function drawHumanRect(canvas, ctx, frame, color) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (frame && frame.rects && frame.rects.length > 0) {
            const r = frame.rects[0];
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.strokeRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
        }
    }

    function compareHumanMovement(f1, f2, canvas, ctx) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!f1 || !f2 || !f1.rects.length || !f2.rects.length) return;

        const r1 = f1.rects[0];
        const r2 = f2.rects[0];

        // 1. お手本のゴースト表示
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#FFEB3B';
        ctx.strokeRect(r1.x * canvas.width, r1.y * canvas.height, r1.w * canvas.width, r1.h * canvas.height);
        ctx.setLineDash([]);

        // 2. 自分の表示
        ctx.strokeStyle = '#00FF00';
        ctx.strokeRect(r2.x * canvas.width, r2.y * canvas.height, r2.w * canvas.width, r2.h * canvas.height);

        // 3. 中心点同士を結ぶ（ズレの可視化）
        ctx.beginPath();
        ctx.strokeStyle = '#FF3D00';
        ctx.moveTo(r1.center_x * canvas.width, r1.center_y * canvas.height);
        ctx.lineTo(r2.center_x * canvas.width, r2.center_y * canvas.height);
        ctx.stroke();

        // 4. スコア計算
        const dist = Math.sqrt(Math.pow(r1.center_x - r2.center_x, 2) + Math.pow(r1.center_y - r2.center_y, 2));
        const score = Math.max(0, 100 - Math.round(dist * 200));
        
        document.getElementById('sync-score').innerText = score;
        document.getElementById('gap-px').innerText = Math.round(dist * canvas.width);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 同期再生ロジック
    const v1 = document.getElementById('video1');
    const v2 = document.getElementById('video2');
    if (v1 && v2) {
        v1.addEventListener('play', () => v2.play());
        v1.addEventListener('pause', () => v2.pause());
        v1.addEventListener('seeking', () => v2.currentTime = v1.currentTime);
    }
    initHumanDetection();
});
