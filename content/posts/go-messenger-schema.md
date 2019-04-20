---
title: "Building a Messenger App: Schema"
description: "Building a messenger app: schema"
tags: ["sql"]
date: 2018-07-05T17:42:56-04:00
lastmod: 2019-04-19T22:35:17-04:00
draft: false
---

New post on building a messenger app.
You already know this kind of app. They allow you to have conversations with your friends. [Facebook Messenger](https://www.messenger.com/), [WhatsApp](https://www.whatsapp.com/) and [Skype](https://www.skype.com/) are a few examples. Tho, these apps allows you to send pictures, stream video, record audio, chat with large groups of people, etc... We'll try to keep it simple and just send text messages between two users.

We'll use [CockroachDB](https://www.cockroachlabs.com/) as the SQL database, [Go](https://golang.org/) as the backend language, and JavaScript to make a web app.

In this first post, we're getting around the database design.

```sql
CREATE TABLE users (
    id SERIAL NOT NULL PRIMARY KEY,
    username STRING NOT NULL UNIQUE,
    avatar_url STRING,
    github_id INT NOT NULL UNIQUE
);
```

Of course, this app requires users. We will go with social login. I selected just [GitHub](https://github.com/) so we keep a reference to the github user ID there.

```sql
CREATE TABLE conversations (
    id SERIAL NOT NULL PRIMARY KEY,
    last_message_id INT,
    INDEX (last_message_id DESC)
);
```

Each conversation references the last message. Every time we insert a new message, we'll go and update this field.
(I'll add the foreign key constraint below).

... You can say that we can group conversations and get the last message that way, but that will add much more complexity to the queries.

```sql
CREATE TABLE participants (
    user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
    conversation_id INT NOT NULL REFERENCES conversations ON DELETE CASCADE,
    messages_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, conversation_id)
);
```

Even tho I said conversations will be between just two users, we'll go with a design that allow the possibility to add multiple participants to a conversation. That's why we have a participants table between the conversation and users.

To know whether the user has unread messages we have the `messages_read_at` field. Every time the user read in a conversation, we update this value, so we can compare it with the conversation last message `created_at` field.

```sql
CREATE TABLE messages (
    id SERIAL NOT NULL PRIMARY KEY,
    content STRING NOT NULL,
    user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
    conversation_id INT NOT NULL REFERENCES conversations ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    INDEX(created_at DESC)
);
```

Last but not least is the messages table, it saves a reference to the user who created it and the conversation in which it goes. Is has an index on `created_at` too to sort messages.

```sql
ALTER TABLE conversations
ADD CONSTRAINT fk_last_message_id_ref_messages
FOREIGN KEY (last_message_id) REFERENCES messages ON DELETE SET NULL;
```

And yep, the fk constraint I said.

These four tables will do the trick. You can save those queries to a file and pipe it to the Cockroach CLI. First start a new node:

```bash
cockroach start --insecure --host 127.0.0.1
```

Then create the database and tables:

```bash
cockroach sql --insecure -e "CREATE DATABASE messenger"
cat schema.sql | cockroach sql --insecure -d messenger
```

---

That's it. In the next part we'll do the login. Wait for it.

[Souce Code](https://github.com/nicolasparada/go-messenger-demo)
