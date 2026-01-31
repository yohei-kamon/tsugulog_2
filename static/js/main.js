// 動画の同期再生
document.querySelectorAll('.comparison-container').forEach(container => {
    const v1 = container.querySelector('.video-1');
    const v2 = container.querySelector('.video-2');

    if (v1 && v2) {
        v1.addEventListener('play', () => v2.play());
        v1.addEventListener('pause', () => v2.pause());
        v1.addEventListener('seeking', () => { v2.currentTime = v1.currentTime; });
    }
});

// Ajaxによるいいね機能
async function toggleLike(postId) {
    const response = await fetch(`/like/${postId}`, {
        method: 'POST',
        headers: { 'X-CSRFToken': document.querySelector('#csrf_token')?.value || '' }
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
