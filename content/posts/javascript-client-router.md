---
title: "JavaScript Client Router"
description: "Coding a router for building single page applications with JavaScript"
tags: ["javascript"]
date: 2018-04-25T22:21:12-03:00
tweet_id: 989317009900036097
draft: false
---

There are a lot of frameworks/libraries to build single page applications, but I wanted something more minimal.
I've come with a solution and I just wanted to share it.

```js
class Router {
    constructor() {
        this.routes = []

        this.handle = this.handle.bind(this)
        this.exec = this.exec.bind(this)
    }

    handle(pattern, handler) {
        this.routes.push({ pattern, handler })
    }

    exec(pathname) {
        for (const route of this.routes) {
            if (typeof route.pattern === 'string') {
                if (route.pattern !== pathname) continue
                return route.handler()
            }
            const match = route.pattern.exec(pathname)
            if (match === null) continue
            return route.handler(...match.slice(1))
        }
    }
}
```

```js
const router = new Router()

router.handle('/', homePageHandler)
router.handle(/^\/users\/([^\/]+)$/, userPageHandler)
router.handle(/^\//, notFoundPageHandler)

function homePageHandler() {
    return 'home page'
}

function userPageHandler(username) {
    return `${username}'s page`
}

function notFoundPageHandler() {
    return 'not found page'
}

console.log(router.exec('/')) // home page
console.log(router.exec('/users/john')) // john's page
console.log(router.exec('/foo')) // not found page
```

To use it you add handlers for a URL pattern. This pattern can be a simple string or a regular expression. Using a string will match exactly that, but using a regular expression allows you to do fancy things like extract parameters from the URL as seen on `userPageHandler` or match any URL as seen on `notFoundPageHandler`.

I'll explain what does that `exec` method... As I said, the URL pattern can be a string or a regular expression, so it first checks for a string. In case the pattern is equal to the given pathname, it returns the execution of the handler. If it is not a string, then it's a regular expression, so it uses the `.exec()` method of the regexp against the given pathname. In case it matches, it returns the execution of the handler passing to it the parameters with `match.slice(1)`.

## Working example

That example, just logs to the console. Let's try to integrate it to a page and see something.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JavaScript Client Router Demo</title>
    <link rel="shortcut icon" href="data:,">
    <script src="/main.js" type="module"></script>
</head>
<body>
    <nav>
        <a href="/">Home</a>
        <a href="/users/john_doe">Profile</a>
        <a href="/bar">Foo</a>
        <a href="/qux">Baz</a>
    </nav>
    <div id="page-outlet"></div>
</body>
</html>
```

This is the `index.html`. For single page applications, you must do special work on the server side because all unknown paths should return this `index.html`.
For development, I'm using an npm tool called [serve](https://npm.im/serve). This tool is to serve static content. With the flag `-s`/`--single` you can serve single page applications.

With [Node.js](https://nodejs.org/) and npm (comes with Node) installed, run:

```bash
npm i -g serve
serve -s
```

That HTML file loads the script `main.js` as a module. It has a `<nav>` and a  `<div id=page-outlet>` in which we'll render the corresponding page.

I moved the previous `Router` class to a `router.js` file.

```js
export default class Router {
    // ...
}
```

Inside the `main.js` file:

```js
import Router from './router.js'

const router = new Router()

router.handle('/', homePageHandler)
router.handle(/^\/users\/([^\/]+)$/, userPageHandler)
router.handle(/^\//, notFoundPageHandler)

function homePageHandler() {
    const h1 = document.createElement('h1')
    h1.textContent = 'Home Page'
    return h1
}

function userPageHandler(username) {
    const h1 = document.createElement('h1')
    h1.textContent = `${username}'s Page`
    return h1
}

function notFoundPageHandler() {
    const h1 = document.createElement('h1')
    h1.textContent = 'Not Found Page'
    return h1
}

const pageOutlet = document.getElementById('page-outlet')
const page = router.exec(decodeURI(location.pathname))
pageOutlet.appendChild(page)
```

Now the handlers... instead of returning some message text, they return actual DOM; in this case, they all return a `HTMLHeadingElement` (`<h1>`), but you can return any instance of `Node` like a `DocumentFragment` or a `HTMLTemplateElement` content.

Below, we call `router.exec()` passing `location.pathname` and append the result to the page outlet div.

*We decode `location.pathname` to not get weird symbols in the params.*

If you go to localhost and play with it. You'll see that it works, but not as you expect from an SPA. Single page applications shouldn't refresh when you click on links.

We'll have to attach click event listeners to each anchor tag, prevent the default behavior and do the correct rendering.
Because a single page application is something dynamic, you expect creating anchor links on the fly so to add the event listeners I'll use a technique called [event delegation](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events#Event_delegation).

I'll add a click event listener globally and check if that click was on an anchor link or inside one and walk up the parents until finding it.

In the `Router` class I'll add a static method:

```js
static delegateClicks(ev) {
    if (ev.defaultPrevented
        || ev.altKey
        || ev.ctrlKey
        || ev.metaKey
        || ev.shiftKey
        || ev.button !== 0) return

    const a = Array
        .from(walkParents(ev.target))
        .find(n => n instanceof HTMLAnchorElement)

    if (!(a instanceof HTMLAnchorElement)
        || (a.target !== '' && a.target !== '_self')
        || a.hostname !== location.hostname)
        return

    ev.preventDefault()
    Router.updateHistory(a.href)
}
```

First, it returns early if the click wasn't a normal left click.
Using `walkParents` function, we filter until finding an anchor element. We early return also if the link uses a special target ("_blank" for example) or if the link goes outside our site. If all that passes, we prevent the default and update the browser history with the link `href`.

```js
static updateHistory(href, redirect = false) {
    const { state } = history
    history[redirect ? 'replaceState' : 'pushState'](state, document.title, href)
    dispatchEvent(new PopStateEvent('popstate', { state }))
}
```

`updateHistory` is also a static method of the Router. This function updates the history of the browser, but also dispatches a "popstate" event. So, if you want to trigger a page render outside of link navigation, you can use this method.

```js
function* walkParents(node) {
    do {
        yield node
    } while ((node = node.parentNode) instanceof Node)
}
```

`walkParents` is a generator that yields with the node parents.

Now, back to the `main.js` file we'll move that previous render we did in the page outlet div to a function.

```js
const pageOutlet = document.getElementById('page-outlet')
let currentPage
function render() {
    if (currentPage instanceof Node)
        pageOutlet.innerHTML = ''
    currentPage = router.exec(decodeURI(location.pathname))
    pageOutlet.appendChild(currentPage)
}
render()

addEventListener('click', Router.delegateClicks)
addEventListener('popstate', render)
```

So, first we delegate the clicks; every click on a link will dispatch a "popstate" event and on every "popstate" event we do a render.
I used popstate because it's an event that occurs also when you use the back/forward browser arrows.

## Code-Splitting

Going further beyond with the new dynamic `import()` 🔥 we can have code-splitting so easy.
For example, let's move the `userPageHandler` to a file `pages/user-page.js`:

```js
export default function userPageHandler(username) {
    // ...
}
```

Now, in the router handler we can import it:

```js
router.handle(/^\/users\/([^\/]+)$/, username => {
    return import('./pages/user-page.js')
        .then(m => m.default)
        .then(h => h(username))
})
```

But you'll have to update the `render` function to handle the promise `import()` returns.

```js
async function render() {
    // ...
    currentPage = await router.exec(decodeURI(location.pathname))
    // ...
}
```

Dynamic import is so cool, but you must know it doesn't have good support yet. It's a stage 3 proposal; only Chrome and Safari by the moment. The good news is, it's [polyfillable](https://gist.github.com/tbranyen/9496397c3f422ebadc382e7daffc1dc6).

## Loading Indicator

Now that we have code-splitting, pages won't load instantly, so add a "loading" message to the HTML code:

```html
<div id="page-outlet">
    Loading...
</div>
```

Now, before starting to load the page, we'll show this message and after the page has loaded, we'll clear it.

```js
const loadingHTML = pageOutlet.innerHTML

function render() {
    if (currentPage instanceof Node)
        pageOutlet.innerHTML = loadingHTML
    currentPage = await router.exec(decodeURI(location.pathname))
    pageOutlet.innerHTML = ''
    pageOutlet.appendChild(currentPage)
}
```

## Caching

Of course, you can go as far as you want, but I've found very useful caching the page handlers when using dynamic import.

```js
const modulesCache = new Map()
async function importWithCache(specifier) {
    if (modulesCache.has(specifier))
        return modulesCache.get(specifier)
    const m = await import(specifier)
    modulesCache.set(specifier, m)
    return m
}
```

This function uses a `Map` to save in memory modules once you import them. Now we can do a wrapper over it to import the page handlers.

```js
function view(name) {
    return (...args) => importWithCache(`/pages/${name}-page.js`)
        .then(m => m.default)
        .then(h => h(...args))
}
```

```js
router.handle('/', view('home'))
router.handle(/^\/users\/([^\/]+)$/, view('user'))
router.handle(/^\//, view('not-found'))
```

## Disconnect

Last but not least is a way to inform the pages that the user is leaving them.

In the `render` function:

```js
const disconnectEvent = new CustomEvent('disconnect')
async function render() {
    if (currentPage instanceof Node) {
        currentPage.dispatchEvent(disconnectEvent)
        // ...
    }
    // ...
}
```

Using the event system that comes with the DOM, we can dispatch to the current page an event. A custom "disconnect" event.

```js
export default function homePageHandler() {
    const h1 = document.createElement('h1')
    h1.textContent = 'Home Page'
    h1.addEventListener('disconnect', () => {
        console.log('Leaving home page')
    })
    return h1
}
```

And you can attach a listener if you want to know when the user leaves.

---

I wanted to share this because I'll use this router for JavaScript clients I will demo in this blog.
Continuing with the [post of the past week](/posts/passwordless-auth-server/), I'll code a client using this 👨‍💻

You can see a working demo [here](https://javascript-client-router-demo.netlify.com/) and the source code [here](https://github.com/nicolasparada/javascript-client-router-demo).
