let loadingGitalk = false

const comments = document.getElementById('comments')
const id = comments.dataset['id']

const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
        if (!entry.isIntersecting || loadingGitalk) continue

        loadingGitalk = true

        loadCSS('https://unpkg.com/gitalk/dist/gitalk.css')
        loadScript('https://unpkg.com/gitalk/dist/gitalk.min.js').then(() => {
            if (!('Gitalk' in window)) return

            const gitalk = new window['Gitalk']({
                clientID: '307519edbcc010611b77',
                clientSecret: '2da65e23d64ff6b8c346c5d227a80263e543c339',
                repo: 'blog',
                owner: 'nicolasparada',
                admin: ['nicolasparada'],
                id,
            })

            gitalk.render(comments)

            observer.unobserve(comments)
            observer.disconnect()
        }).catch(console.error)
        break
    }
})

if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
    observer.observe(comments)
}

function loadCSS(href) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src
        script.onload = resolve
        script.onerror = reject
        document.head.appendChild(script)
    })
}
