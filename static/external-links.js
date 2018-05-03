const links = Array.from(document.querySelectorAll('a'))
for (const link of links) {
    if (link.hostname !== location.hostname) {
        link.target = '_blank'
        link.rel = 'noopener'
    }
}
