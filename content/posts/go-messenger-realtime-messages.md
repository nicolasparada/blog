---
title: "Building a Messenger App: Realtime Messages"
description: "Building a messenger app: realtime messages"
tags: ["golang", "sql"]
date: 2018-07-10T17:24:52-04:00
lastmod: 2018-08-09T17:15:07-04:00
tweet_id: 1016809612065034240
draft: false
---

This post is the 5th on a series:

- [Part 1: Schema](/posts/go-messenger-schema/)
- [Part 2: OAuth](/posts/go-messenger-oauth/)
- [Part 3: Conversations](/posts/go-messenger-conversations/)
- [Part 4: Messages](/posts/go-messenger-messages/)

For realtime messages we'll use [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events). This is an open connection in which we can stream data. We'll have and endpoint in which the user subscribes to all the messages sended to him.

## Message Bus

Before the HTTP part, let's code a map to have all the clients listening for messages.

```go
type MessageBus struct {
	μ       sync.Mutex
	Clients map[MessageClient]struct{}
}

type MessageClient struct {
	Ch     chan Message
	UserID string
}

func (bus *MessageBus) register(ch chan Message, userID string) func() {
	client := MessageClient{ch, userID}

	bus.μ.Lock()
	defer bus.μ.Unlock()
	bus.Clients[client] = struct{}{}

	return func() {
		bus.μ.Lock()
		defer bus.μ.Unlock()
		delete(bus.Clients, client)
	}
}

func (bus *MessageBus) send(message Message) {
	bus.μ.Lock()
	defer bus.μ.Unlock()
	for client := range bus.Clients {
		if client.UserID == message.ReceiverID {
			client.Ch <- message
		}
	}
}
```

In the message bus, we have a mutex to prevent race conditions in the `Clients` map. The message client struct holds a channel of messages and a user ID to filter those messages.

In the `register()` method we add the client to the map and return a function to remove the client.

In the `send()` function we iterate over the clients, filter them and send the message over the channel.

Initialize this bus globally like so:

```go
var messageBus = &MessageBus{Clients: make(map[MessageClient]struct{})}
```

## New Message Created

Remember in the [last post](/posts/go-messenger-messages/) when we created the message, we left a "TODO" comment. There we'll dispatch a goroutine with this function.

```go
go newMessageCreated(message)
```

Insert that line just where we left the comment.

```go
func newMessageCreated(message Message) error {
	if err := db.QueryRow(`
		SELECT user_id FROM participants
		WHERE user_id != $1 and conversation_id = $2
	`, message.UserID, message.ConversationID).
    Scan(&message.ReceiverID); err != nil {
		return err
	}

	messageBus.send(message)
	return nil
}
```

This function queries for the recipient ID (the other participant ID) and uses the messageBus to send the message to all the clients.

## Subscribe to Messages

Lets go to the `main()` function and add this route:

```go
router.HandleFunc("GET", "/api/messages", guard(subscribeToMessages))
```

This endpoint handles GET requests on `/api/messages`. The request should be an [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) connection. It responds with an event stream in which the data is JSON formatted.

```go
func subscribeToMessages(w http.ResponseWriter, r *http.Request) {
	if a := r.Header.Get("Accept"); !strings.Contains(a, "text/event-stream") {
		http.Error(w, "This endpoint requires an EventSource connection", http.StatusNotAcceptable)
		return
	}

	f, ok := w.(http.Flusher)
	if !ok {
		respondError(w, errors.New("streaming unsupported"))
		return
	}

	ctx := r.Context()
	authUserID := ctx.Value(keyAuthUserID).(string)

	h := w.Header()
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("Content-Type", "text/event-stream")

	ch := make(chan Message)
	defer close(ch)
	defer messageBus.register(ch, authUserID)()

	for {
		select {
		case <-w.(http.CloseNotifier).CloseNotify():
			return
		case message := <-ch:
			if b, err := json.Marshal(message); err != nil {
                log.Printf("could not marshall message: %v\n", err)
				fmt.Fprintf(w, "error: %v\n\n", err)
			} else {
				fmt.Fprintf(w, "data: %s\n\n", b)
			}
			f.Flush()
		}
	}
}
```

First it checks for the correct request headers and checks the server supports streaming. We create a channel of messages and register it in the bus. Each time a new message is created, it will go in this channel, so we can read from it with a `for-select` loop.

Server-Sent Events uses this format to send data:

```
data: some data here\n\n
```

We are sending it in JSON format:
```
data: {"foo":"bar"}\n\n
```

We are using `fmt.Fprintf()` to write to the response writter in this format and flushing the data in each iteration of the loop.

This will loop until the connection is closed using the response close notifier interface. We defered the close of the channel and the unregistration of the client, so when the loop ends, the channel will be closed and the client unregistered.

Note aside, the JavaScript API to work with Server-Sent Events (EventSource) doesn't support setting custom headers 😒 So we cannot set `Authorization: Bearer token_here`. And that's the reason why the `guard()` middleware reads the token from the URL query string also.

---

That concludes the realtime messages.
I'd like to say that's everything in the backend, but to code the frontend I'll add one more endpoint to login. A login that will be just for development.

Got any question, advice or comment? Leave it below 👇

[Souce Code](https://github.com/nicolasparada/go-messenger-demo)
