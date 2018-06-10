---
title: "Passwordless Auth: Client"
description: "Coding a client in JavaScript for a passwordless auth HTTP API"
tags: ["javascript"]
date: 2018-04-29T22:18:24-03:00
tweet_id: 990763235065450496
draft: false
---

Time to continue with the [passwordless auth](/posts/passwordless-auth-server/) posts.
Previously, we wrote an HTTP service in Go that provided with a passwordless authentication API. Now, we are gonna code a JavaScript client for it.

We'll go with a single page application (SPA) using the technique I showed [here](/posts/javascript-client-router/). Read it first if you haven't yet.

For the root URL (`/`) we'll show two different pages depending on the auth state: a page with an access form or a page greeting the authenticated user. Another page is for the auth callback redirect.

## Serving

I'll serve the client with the same Go server, so let's add some routes to the previous `main.go`:

```js
router.Handle("GET", "/js/", http.FileServer(http.Dir("static")))
router.HandleFunc("GET", "/...", serveFile("static/index.html"))
```

This serves files under `static/js`, and `static/index.html` is served for everything else.

You can use your own server apart, but you'll have to enable [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) on the server.

## HTML

Let's see that `static/index.html`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Passwordless Demo</title>
    <link rel="shortcut icon" href="data:,">
    <script src="/js/main.js" type="module"></script>
</head>
<body></body>
</html>
```

Single page application left all the rendering to JavaScript, so we have an empty body and a `main.js` file.

I'll user the Router from the [last post](/posts/javascript-client-router/).

## Rendering

Now, create a `static/js/main.js` file with the following content:

```js
import Router from 'https://unpkg.com/@nicolasparada/router'
import { isAuthenticated } from './auth.js'

const router = new Router()

router.handle('/', guard(view('home')))
router.handle('/callback', view('callback'))
router.handle(/^\//, view('not-found'))

router.install(async resultPromise => {
    document.body.innerHTML = ''
    document.body.appendChild(await resultPromise)
})

function view(name) {
    return (...args) => import(`/js/pages/${name}-page.js`)
        .then(m => m.default(...args))
}

function guard(fn1, fn2 = view('welcome')) {
    return (...args) => isAuthenticated()
        ? fn1(...args)
        : fn2(...args)
}
```

Differing from the last post, we implement an `isAuthenticated()` function and a `guard()` function that uses it to render one or another page. So when a user visits `/` it will show the home or welcome page whether the user is authenticated or not.

## Auth

Now, let's write that `isAuthenticated()` function. Create a `static/js/auth.js` file with the following content:

```js
export function getAuthUser() {
    const authUserItem = localStorage.getItem('auth_user')
    const expiresAtItem = localStorage.getItem('expires_at')

    if (authUserItem !== null && expiresAtItem !== null) {
        const expiresAt = new Date(expiresAtItem)

        if (!isNaN(expiresAt.valueOf()) && expiresAt > new Date()) {
            try {
                return JSON.parse(authUserItem)
            } catch (_) { }
        }
    }

    return null
}

export function isAuthenticated() {
    return localStorage.getItem('jwt') !== null && getAuthUser() !== null
}
```

When someone login, we save the JSON web token, expiration date of it and the current authenticated user on `localStorage`. This module uses that.

- `getAuthUser()` gets the authenticated user from `localStorage` making sure the JSON Web Token hasn't expired yet.
- `isAuthenticated()` makes use of the previous function to check whether it doesn't return `null`.

## Fetch

Before continuing with the pages, I'll code some HTTP utilities to work with the server API.

Let's create a `static/js/http.js` file with the following content:

```js
import { isAuthenticated } from './auth.js'

function get(url, headers) {
    return fetch(url, {
        headers: Object.assign(getAuthHeader(), headers),
    }).then(handleResponse)
}

function post(url, body, headers) {
    return fetch(url, {
        method: 'POST',
        headers: Object.assign(getAuthHeader(), { 'content-type': 'application/json' }, headers),
        body: JSON.stringify(body),
    }).then(handleResponse)
}

function getAuthHeader() {
    return isAuthenticated()
        ? { authorization: `Bearer ${localStorage.getItem('jwt')}` }
        : {}
}

export async function handleResponse(res) {
    const body = await res.clone().json().catch(() => res.text())
    const response = {
        url: res.url,
        statusCode: res.status,
        statusText: res.statusText,
        headers: res.headers,
        body,
    }
    if (!res.ok) throw Object.assign(
        new Error(body.message || body || res.statusText),
        response
    )
    return response
}

export default {
    get,
    post,
}
```

This module exports `get()` and `post()` functions. They are wrappers around the `fetch` API. Both functions inject an `Authorization: Bearer <token_here>` header to the request when the user is authenticated; that way the server can authenticate us.

## Welcome Page

Let's move to the welcome page.
Create a `static/js/pages/welcome-page.js` file with the following content:

```js
const template = document.createElement('template')
template.innerHTML = `
    <h1>Passwordless Demo</h1>
    <h2>Access</h2>
    <form id="access-form">
        <input type="email" placeholder="Email" autofocus required>
        <button type="submit">Send Magic Link</button>
    </form>
`

export default function welcomePage() {
    const page = template.content.cloneNode(true)

    page.getElementById('access-form')
        .addEventListener('submit', onAccessFormSubmit)

    return page
}
```

This page uses an `HTMLTemplateElement` for the view. It is just a simple form to enter the user's email.

To not make this boring, I'll skip error handling and just log them to console.

Now, let's code that `onAccessFormSubmit()` function.

```js
import http from '../http.js'

function onAccessFormSubmit(ev) {
    ev.preventDefault()

    const form = ev.currentTarget
    const input = form.querySelector('input')
    const email = input.value

    sendMagicLink(email).catch(err => {
        console.error(err)
        if (err.statusCode === 404 && wantToCreateAccount()) {
            runCreateUserProgram(email)
        }
    })
}

function sendMagicLink(email) {
    return http.post('/api/passwordless/start', {
        email,
        redirectUri: location.origin + '/callback',
    }).then(() => {
        alert('Magic link sent. Go check your email inbox.')
    })
}

function wantToCreateAccount() {
    return prompt('No user found. Do you want to create an account?')
}
```

It does a `POST` request to `/api/passwordless/start` with the email and redirectUri in the body. In case it returns with `404 Not Found` status code, we'll create a user.

```js
function runCreateUserProgram(email) {
    const username = prompt("Enter username")
    if (username === null) return

    http.post('/api/users', { email, username })
        .then(res => res.body)
        .then(user => sendMagicLink(user.email))
        .catch(console.error)
}
```

The user creation program, first, ask for username and does a `POST` request to `/api/users` with the email and username in the body. On success, it sends a magic link for the user created.

## Callback Page

That was all the functionality for the access form, let's move to the callback page.
Create a `static/js/pages/callback-page.js` file with the following content:

```js
import http from '../http.js'

const template = document.createElement('template')
template.innerHTML = `
    <h1>Authenticating you 👀</h1>
`

export default function callbackPage() {
    const page = template.content.cloneNode(true)

    const hash = location.hash.substr(1)
    const fragment = new URLSearchParams(hash)
    for (const [k, v] of f.entries()) {
        fragment.set(decodeURIComponent(k), decodeURIComponent(v))
    }
    const jwt = fragment.get('jwt')
    const expiresAt = fragment.get('expires_at')

    http.get('/api/auth_user', { authorization: `Bearer ${jwt}` })
        .then(res => res.body)
        .then(authUser => {
            localStorage.setItem('jwt', jwt)
            localStorage.setItem('auth_user', JSON.stringify(authUser))
            localStorage.setItem('expires_at', expiresAt)

            location.replace('/')
        })
        .catch(console.error)

    return page
}
```

To remember... when clicking the magic link, we go to `/api/passwordless/verify_redirect` which redirect us to the redirect URI we pass (`/callback`) with the JWT and expiration date in the URL hash.

The callback page decodes the hash from the URL to extract those parameters to do a `GET` request to `/api/auth_user` with the JWT saving all the data to `localStorage`. Finally, it just redirects to home.

## Home Page

Create a `static/pages/home-page.js` file with the following content:

```js
import { getAuthUser } from '../auth.js'

export default function homePage() {
    const authUser = getAuthUser()

    const template = document.createElement('template')
    template.innerHTML = `
        <h1>Passwordless Demo</h1>
        <p>Welcome back, ${authUser.username} 👋</p>
        <button id="logout-button">Logout</button>
    `

    const page = template.content

    page.getElementById('logout-button')
        .addEventListener('click', logout)

    return page
}

function logout() {
    localStorage.clear()
    location.reload()
}
```

This page greets the authenticated user and also has a logout button. The `logout()` function just clears `localStorage` and reloads the page.

---

There is it. I bet you already saw the [demo](https://go-passwordless-demo.herokuapp.com/) before.
Also, the source code is in the same [repository](https://github.com/nicolasparada/go-passwordless-demo).

👋👋👋
