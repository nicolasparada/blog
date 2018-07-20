---
title: "Building a Messenger App: Conversation Page"
description: "Building a messenger app: conversation page"
tags: ["javascript"]
date: 2018-07-20T12:15:43-04:00
lastmod: 2018-07-20T12:15:43-04:00
tweet_id: 1020345424522235910
draft: false
---

This post is the 9th and last in a series:

- [Part 1: Schema](/posts/go-messenger-schema/)
- [Part 2: OAuth](/posts/go-messenger-oauth/)
- [Part 3: Conversations](/posts/go-messenger-conversations/)
- [Part 4: Messages](/posts/go-messenger-messages/)
- [Part 5: Realtime Messages](/posts/go-messenger-realtime-messages/)
- [Part 6: Development Login](/posts/go-messenger-dev-login/)
- [Part 7: Access Page](/posts/go-messenger-access-page/)
- [Part 8: Home Page](/posts/go-messenger-home-page/)

In this post we'll code the conversation page. This page is the chat between the two users. At the top we'll show info about the other participant, below, a list of the latest messages and a message form at the bottom.

## Chat heading

![chat heading screenshot](/img/go-messenger-conversation-page/heading.png)

Let's start by creating the file `static/pages/conversation-page.js` with the following content:

```js
import http from '../http.js'
import { navigate } from '../router.js'
import { avatar, escapeHTML } from '../shared.js'

export default async function conversationPage(conversationId) {
    let conversation
    try {
        conversation = await getConversation(conversationId)
    } catch (err) {
        alert(err.message)
        navigate('/', true)
        return
    }

    const template = document.createElement('template')
    template.innerHTML = `
        <div>
            <a href="/">← Back</a>
            ${avatar(conversation.otherParticipant)}
            <span>${conversation.otherParticipant.username}</span>
        </div>
        <!-- message list here -->
        <!-- message form here -->
    `
    const page = template.content
    return page
}

function getConversation(id) {
    return http.get('/api/conversations/' + id)
}
```

This page receives the conversation ID the router extracted from the URL.

First it does a GET request to `/api/conversations/conversation_id_here` to get info about the conversation. In case of error, we show it and redirect back to `/`. Then we render info about the other participant.

## Conversation List

![chat heading screenshot](/img/go-messenger-conversation-page/list.png)

We'll fetch the latest messages too to display them.

```js
let conversation, messages
try {
    [conversation, messages] = await Promise.all([
        getConversation(conversationId),
        getMessages(conversationId),
    ])
}
```

Update the `conversationPage()` function to fetch the messages too. We use `Promise.all()` to do both request at the same time.

```js
function getMessages(conversationId) {
    return http.get(`/api/conversations/${conversationId}/messages`)
}
```

A GET request to `/api/conversations/conversation_id_here/messages` gets the latest messages of the conversation.

```html
<ol id="messages"></ol>
```

Now, add that list to the markup.

```js
const messagesOList = page.getElementById('messages')
for (const message of messages) {
    messagesOList.appendChild(renderMessage(message))
}
```

So we can append messages to the list.

```js
function renderMessage(message) {
    const messageContent = escapeHTML(message.content)
    const messageDate = new Date(message.createdAt).toLocaleString()

    const li = document.createElement('li')
    if (message.mine) {
        li.classList.add('owned')
    }
    li.innerHTML = `
        <p>${messageContent}</p>
        <time>${messageDate}</time>
    `
    return li
}
```

Each message item displays the message content itself with its timestamp. Using `.mine` we can append a different class to the item so maybe you can show the message to the right.

There is a CSS tip for you 🤓 On chats, it's common to show the latest messages at the bottom and scroll up to see the messages history. You can show them in that order using `flex-direction: column-reverse` on the parent element.

```css
#messages {
    display: flex;
    flex-direction: column-reverse;
    overflow-y: auto;
}
```

## Message Form

![chat heading screenshot](/img/go-messenger-conversation-page/form.png)

```html
<form id="message-form">
    <input type="text" placeholder="Type something" maxlength="480" required>
    <button>Send</button>
</form>
```

Add that form to the current markup.

```js
page.getElementById('message-form').onsubmit = messageSubmitter(conversationId)
```

Attach an event listener to the "submit" event.

```js
function messageSubmitter(conversationId) {
    return async ev => {
        ev.preventDefault()

        const form = ev.currentTarget
        const input = form.querySelector('input')
        const submitButton = form.querySelector('button')

        input.disabled = true
        submitButton.disabled = true

        try {
            const message = await createMessage(input.value, conversationId)
            input.value = ''
            const messagesOList = document.getElementById('messages')
            if (messagesOList === null) {
                return
            }

            messagesOList.insertAdjacentElement('afterbegin', renderMessage(message))
        } catch (err) {
            if (err.statusCode === 422) {
                input.setCustomValidity(err.body.errors.content)
            } else {
                alert(err.message)
            }
        } finally {
            input.disabled = false
            submitButton.disabled = false

            setTimeout(() => {
                input.focus()
            }, 0)
        }
    }
}

function createMessage(content, conversationId) {
    return http.post(`/api/conversations/${conversationId}/messages`, { content })
}
```

We make use of [partial application](https://en.wikipedia.org/wiki/Partial_application) to have the conversation ID in the "submit" event handler. It takes the message content from the input and does a POST request to `/api/conversations/conversation_id_here/messages` with it. Then prepends the newly created message to the list.

## Messages Subscription

To make it realtime we'll subscribe to the message stream in this page also.

```js
page.addEventListener('disconnect', subscribeToMessages(messageArriver(conversationId)))
```

Add that line in the `conversationPage()` function.

```js
function subscribeToMessages(cb) {
    return http.subscribe('/api/messages', cb)
}

function messageArriver(conversationId) {
    return message => {
        if (message.conversationId !== conversationId) {
            return
        }

        const messagesOList = document.getElementById('messages')
        if (messagesOList === null) {
            return

        }
        messagesOList.insertAdjacentElement('afterbegin', renderMessage(message))
        readMessages(message.conversationId)
    }
}

function readMessages(conversationId) {
    return http.post(`/api/conversations/${conversationId}/read_messages`)
}
```

We also make use of partial application to have the conversation ID here.
<br>
When a new message arrives, first we check if it's from this conversation. If it is, we go a prepend a message item to the list and do a POST request to `/api/conversations/conversation_id_here/read_messages` to updated the last time the participant read messages.

---

That concludes this series. The messenger app is now functional.

I'll add pagination on the conversation and message list, also user searching before sharing the source code. I'll updated once it's ready along with a hosted demo 👨‍💻
