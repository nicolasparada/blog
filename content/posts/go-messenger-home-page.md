---
title: "Building a Messenger App: Home Page"
description: "Building a messenger app: home page"
tags: ["javascript"]
date: 2018-07-19T10:32:06-04:00
lastmod: 2018-07-19T10:32:06-04:00
tweet_id:
draft: false
---

This post is the 8th on a series:

- [Part 1: Schema](/posts/go-messenger-schema/)
- [Part 2: OAuth](/posts/go-messenger-oauth/)
- [Part 3: Conversations](/posts/go-messenger-conversations/)
- [Part 4: Messages](/posts/go-messenger-messages/)
- [Part 5: Realtime Messages](/posts/go-messenger-realtime-messages/)
- [Part 6: Development Login](/posts/go-messenger-dev-login/)
- [Part 7: Access Page](/posts/go-messenger-access-page/)

Continuing the frontend, let's finish the home page in this post. We'll add a form to start conversations and a list with the latest ones.

## Conversation Form

![conversation form screenshot](/img/go-messenger-home-page/conversation-form.png)

In the `static/pages/home-page.js` file add some markup in the HTML view.

```html
<form id="conversation-form">
    <input type="search" placeholder="Start conversation with..." required>
</form>
```

Add that form just below the section in which we displayed the auth user and logout button.

```js
page.getElementById('conversation-form').onsubmit = onConversationSubmit
```

Now we can listen to the "submit" event to create the conversation.

```js
import http from '../http.js';
import { navigate } from '../router.js'

async function onConversationSubmit(ev) {
    ev.preventDefault()

    const form = ev.currentTarget
    const input = form.querySelector('input')

    input.disabled = true

    try {
        const conversation = await createConversation(input.value)
        input.value = ''
        navigate('/conversations/' + conversation.id)
    } catch (err) {
        if (err.statusCode === 422) {
            input.setCustomValidity(err.body.errors.username)
        } else {
            alert(err.message)
        }
        setTimeout(() => {
            input.focus()
        }, 0)
    } finally {
        input.disabled = false
    }
}

function createConversation(username) {
    return http.post('/api/conversations', { username })
}
```

On submit we do a POST request to `/api/conversations` with the username and redirect to the conversation page (for the next post).

## Conversation List

![conversation list screenshot](/img/go-messenger-home-page/conversation-list.png)

In the same file, we are going to make the `homePage()` function async to load the conversations first.

```js
export default async function homePage() {
    const conversations = await getConversations().catch(err => {
        console.error(err)
        return []
    })
    /*...*/
}

function getConversations() {
    return http.get('/api/conversations')
}
```

Then, add a list in the markup to render conversations there.

```html
<ol id="conversations"></ol>
```

Add it just below the current markup.

```js
const conversationsOList = page.getElementById('conversations')
for (const conversation of conversations) {
    conversationsOList.appendChild(renderConversation(conversation))
}
```

So we can append each conversation to the list.

```js
import { avatar, escapeHTML } from '../shared.js'

function renderConversation(conversation) {
    const messageContent = escapeHTML(conversation.lastMessage.content)
    const messageDate = new Date(conversation.lastMessage.createdAt).toLocaleString()

    const li = document.createElement('li')
    li.dataset['id'] = conversation.id
    if (conversation.hasUnreadMessages) {
        li.classList.add('has-unread-messages')
    }
    li.innerHTML = `
        <a href="/conversations/${conversation.id}">
            <div>
                ${avatar(conversation.otherParticipant)}
                <span>${conversation.otherParticipant.username}</span>
            </div>
            <div>
                <p>${messageContent}</p>
                <time>${messageDate}</time>
            </div>
        </a>
    `
    return li
}
```

Each conversation item contains a link to the conversation page and displays the other participant info and a preview of the last message. Also, you can use `.hasUnreadMessages` to add a class to the item and do some styling with CSS. Maybe a bolder font or accent the color.

Note that we're escaping the message content. That function comes from `static/shared.js`:

```js
export function escapeHTML(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}
```

That prevents displaying as HTML the message the user wrote. If the user happens to write something like:

```html
<script>alert('lololo')</script>
```

It would be very annoying because that script will be executed 😅
<br>
So yeah, always remember to escape content from untrusted sources.

## Messages Subscription

Last but not least, I want to subscribe to the message stream here.

```js
const unsubscribe = subscribeToMessages(onMessageArrive)
page.addEventListener('disconnect', unsubscribe)
```

Add that line in the `homePage()` function.

```js
function subscribeToMessages(cb) {
    return http.subscribe('/api/messages', cb)
}
```

The `subscribe()` function returns a function that once called it closes the underlying connection. That's why I passed it to the "disconnect" event; so when the user leaves the page, the event stream will be closed.

```js
async function onMessageArrive(message) {
    const conversationLI = document.querySelector(`li[data-id="${message.conversationId}"]`)
    if (conversationLI !== null) {
        conversationLI.classList.add('has-unread-messages')
        conversationLI.querySelector('a > div > p').textContent = message.content
        conversationLI.querySelector('a > div > time').textContent = new Date(message.createdAt).toLocaleString()
        return
    }

    let conversation
    try {
        conversation = await getConversation(message.conversationId)
        conversation.lastMessage = message
    } catch (err) {
        console.error(err)
        return
    }

    const conversationsOList = document.getElementById('conversations')
    if (conversationsOList === null) {
        return
    }

    conversationsOList.insertAdjacentElement('afterbegin', renderConversation(conversation))
}

function getConversation(id) {
    return http.get('/api/conversations/' + id)
}
```

Every time a new message arrives, we go and query for the conversation item in the DOM. If found, we add the `has-unread-messages` class to the item, and update the view. If not found, it means the message is from a new conversation created just now. We go and do a GET request to `/api/conversations/conversation_id_here` to get the conversation in which the message was created and prepend it to the conversation list.

---

That covers the home page 😊
<br>
On the next post we'll code the conversation page.

Got any question, advice or comment? Leave it below 👇
