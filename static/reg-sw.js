const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname)
if (!isLocalhost && 'serviceWorker' in navigator) {
    let worker
    let refreshing = false

    navigator.serviceWorker.register('/sw.js').then(reg => {
        reg.onupdatefound = () => {
            worker = reg.installing
            worker.onstatechange = () => {
                if (navigator.serviceWorker.controller === null || worker.state !== 'installed') {
                    return
                }
                const snackbar = createSnackbar(document.body)
                snackbar.show({
                    message: 'A new version of the blog is available',
                    actionText: 'Reload',
                    actionHandler: reloadSW,
                    timeout: 10000,
                })
            }
        }
    })

    navigator.serviceWorker.oncontrollerchange = () => {
        if (refreshing) {
            return
        }
        refreshing = true
        location.reload()
    }

    function reloadSW() {
        if (worker !== undefined) {
            worker.postMessage({ action: 'skipWaiting' })
        }
    }
}

function createSnackbar(target) {
    const snackbar = document.createElement('div')
    snackbar.className = 'snackbar'
    snackbar.setAttribute('aria-live', 'assertive')
    snackbar.setAttribute('aria-atomic', 'true')
    const snackbarText = document.createTextNode('')
    const snackbarButton = document.createElement('button')
    snackbarButton.textContent = 'Update'
    snackbarButton.onclick = () => {
        snackbar.setAttribute('aria-hidden', 'true')
    }

    snackbar.appendChild(snackbarText)
    snackbar.appendChild(snackbarButton)
    target.appendChild(snackbar)

    let snackbarTimeout

    return {
        show({ message = '', actionText = '', actionHandler = () => { }, timeout = 2750 }) {
            snackbarText.textContent = message
            snackbarButton.textContent = actionText
            snackbarButton.addEventListener('click', actionHandler)
            snackbar.removeAttribute('aria-hidden')
            if (snackbarTimeout !== undefined) {
                clearTimeout(snackbarTimeout)
            }
            snackbarTimeout = setTimeout(() => {
                snackbar.setAttribute('aria-hidden', 'true')
                snackbarButton.removeEventListener('click', actionHandler)
            }, timeout || 2750)
        },
    }
}
