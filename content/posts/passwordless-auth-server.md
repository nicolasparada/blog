---
title: "Passwordless Auth: Server"
description: "Coding a passwordless auth HTTP service in Go"
keywords: ["golang", "sql"]
date: 2018-04-18T10:36:23-03:00
tweet_id: 986602458716803074
draft: false
---

Passwordless authentication allows logging in without a password, just an email. It's a more secure way of doing than the classic email/password login.

I'll show you how to code an HTTP API in [Go](https://golang.org/) that provides this service.

## Flow

- User inputs his email.
- Server creates a temporal on-time-use code associated with the user (like a temporal password) and mails it to the user in form of a "magic link".
- User clicks the magic link.
- Server extract the code from the magic link, fetch the user associated and redirects to the client with a new JWT.
- Client will use the JWT in every new request to authenticate the user.

## Requisites

- Database: We'll use an SQL database called [CockroachDB](https://www.cockroachlabs.com/) for this. It's much like postgres, but writen in Go.
- SMTP Server: To send mails we'll use a third party mailing service. For development we'll use [mailtrap](https://mailtrap.io/). Mailtrap sends all the mails to it's inbox, so you don't have to create multiple fake email accounts to test it.

Install Go from [it's page](https://golang.org/dl/) and check your installation went ok with `go version` (1.10.1 atm).

Download CockroachDB from [it's page](https://www.cockroachlabs.com/docs/stable/install-cockroachdb.html), extract it and add it to your `PATH`. Check that all went ok with `cockroach version` (2.0 atm).

## Database Schema

Now, create a new directory for the project inside `GOPATH` and start a new CockroachDB node with `cockroach start`:

```bash
cockroach start --insecure --host 127.0.0.1
```

It will print some things, but check the SQL address line, it should said something like `postgresql://root@127.0.0.1:26257?sslmode=disable`. We'll use this to connect to the database later.

Create a `schema.sql` file with the following content.

```sql
DROP DATABASE IF EXISTS passwordless_demo CASCADE;
CREATE DATABASE IF NOT EXISTS passwordless_demo;
SET DATABASE = passwordless_demo;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email STRING UNIQUE,
    username STRING UNIQUE
);

CREATE TABLE IF NOT EXISTS verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users (email, username) VALUES
    ('john@passwordless.local', 'john_doe');
```

This script creates a database `passwordless_demo`, two tables: `users` and `verification_codes`, and inserts a fake user just to test it later.
Each verification code is associated with a user and stores the creation date, useful to check if the code is expired or not.

To execute this script use `cockroach sql` in other terminal:

```sql
cat schema.sql | cockroach sql --insecure
```

## Environment Configuration

I want you to set two environment variables: `SMTP_USERNAME` and `SMTP_PASSWORD` that you can get from your mailtrap account. These two will be required by our program.

## Go Dependencies

For Go we'll need the following packages:

- [github.com/lib/pq](https://github.com/lib/pq): Postgres driver which CockroachDB uses.
- [github.com/matryer/way](https://github.com/matryer/way): Router.
- [github.com/dgrijalva/jwt-go](https://github.com/dgrijalva/jwt-go): JWT implementation.

```bash
go get -u github.com/lib/pq
go get -u github.com/matryer/way
go get -u github.com/dgrijalva/jwt-go
```

## Coding

### Init Function

Create the `main.go` and start by getting some configuration from the environment inside the `init` function.

```go
var config struct {
    port        int
    appURL      *url.URL
    databaseURL string
    jwtKey      []byte
    smtpAddr    string
    smtpAuth    smtp.Auth
}

func init() {
    config.port, _ = strconv.Atoi(env("PORT", "80"))
    config.appURL, _ = url.Parse(env("APP_URL", "http://localhost:"+strconv.Itoa(config.port)+"/"))
    config.databaseURL = env("DATABASE_URL", "postgresql://root@127.0.0.1:26257/passwordless_demo?sslmode=disable")
    config.jwtKey = []byte(env("JWT_KEY", "super-duper-secret-key"))
    smtpHost := env("SMTP_HOST", "smtp.mailtrap.io")
    config.smtpAddr = net.JoinHostPort(smtpHost, env("SMTP_PORT", "25"))
    smtpUsername, ok := os.LookupEnv("SMTP_USERNAME")
    if !ok {
        log.Fatalln("could not find SMTP_USERNAME on environment variables")
    }
    smtpPassword, ok := os.LookupEnv("SMTP_PASSWORD")
    if !ok {
        log.Fatalln("could not find SMTP_PASSWORD on environment variables")
    }
    config.smtpAuth = smtp.PlainAuth("", smtpUsername, smtpPassword, smtpHost)
}

func env(key, fallbackValue string) string {
    v, ok := os.LookupEnv(key)
    if !ok {
        return fallbackValue
    }
    return v
}
```

- `appURL` will allow us to build the "magic link".
- `port` in which the HTTP server will start.
- `databaseURL` is the CockroachDB address, I added `/passwordless_demo` to the previous address to indicate the database name.
- `jwtKey` used to sign JWTs.
- `smtpAddr` is a join of `SMTP_HOST` + `SMTP_PORT`; we'll use it to to send mails.
- `smtpUsername` and `smtpPassword` are the two required vars.
- `smtpAuth` is also used to send mails.

The `env` function allow us to get an environment variable with a fallback value in case it doesn't exist.

### Main Function

```go
var db *sql.DB

func main() {
    var err error
    if db, err = sql.Open("postgres", config.databaseURL); err != nil {
        log.Fatalf("could not open database connection: %v\n", err)
    }
    defer db.Close()
    if err = db.Ping(); err != nil {
        log.Fatalf("could not ping to database: %v\n", err)
    }

    router := way.NewRouter()
    router.HandleFunc("POST", "/api/users", jsonRequired(createUser))
    router.HandleFunc("POST", "/api/passwordless/start", jsonRequired(passwordlessStart))
    router.HandleFunc("GET", "/api/passwordless/verify_redirect", passwordlessVerifyRedirect)
    router.Handle("GET", "/api/auth_user", authRequired(getAuthUser))

    addr := fmt.Sprintf(":%d", config.port)
    log.Printf("starting server at %s 🚀\n", config.appURL)
    log.Fatalf("could not start server: %v\n", http.ListenAndServe(addr, router))
}
```

First, it opens a database connection. Remember to load the driver.

```go
import (
    _ "github.com/lib/pq"
)
```

Then, we create the router and define some endpoints. For the passwordless flow we use two endpoints: `/api/passwordless/start` mails the magic link and `/api/passwordless/verify_redirect` respond with the JWT.

Finally, we start the server.

You can create empty handlers and middlewares to test that the server starts.

```go
func createUser(w http.ResponseWriter, r *http.Request) {
    http.Error(w, http.StatusText(http.StatusNotImplemented), http.StatusNotImplemented)
}

func passwordlessStart(w http.ResponseWriter, r *http.Request) {
    http.Error(w, http.StatusText(http.StatusNotImplemented), http.StatusNotImplemented)
}

func passwordlessVerifyRedirect(w http.ResponseWriter, r *http.Request) {
    http.Error(w, http.StatusText(http.StatusNotImplemented), http.StatusNotImplemented)
}

func getAuthUser(w http.ResponseWriter, r *http.Request) {
    http.Error(w, http.StatusText(http.StatusNotImplemented), http.StatusNotImplemented)
}

func jsonRequired(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        next(w, r)
    }
}

func authRequired(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        next(w, r)
    }
}
```

Now:

```bash
go build
./passwordless-demo
```

I'm on a directory called "passwordless-demo", but if yours is different, `go build` will create an executable with that name.
If you didn't close the previous cockroach node and you setted `SMTP_USERNAME` and `SMTP_PASSWORD` vars correctly, you should see `starting server at http://localhost/ 🚀` without errors.

### JSON Required Middleware

Endpoints that need to decode JSON from the request body need to make sure the request is of type `application/json`. Because that is a common thing, I decoupled it to a middleware.

```go
func jsonRequired(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        ct := r.Header.Get("Content-Type")
        isJSON := strings.HasPrefix(ct, "application/json")
        if !isJSON {
            respondJSON(w, "JSON body required", http.StatusUnsupportedMediaType)
            return
        }
        next(w, r)
    }
}
```

As easy as that. First it gets the request content type from the headers, then check if it starts with "application/json", otherwise it early return with `415 Unsupported Media Type`.

### Respond JSON Function

Responding with JSON is also a common thing so I extracted it to a function.

```go
func respondJSON(w http.ResponseWriter, payload interface{}, code int) {
    switch value := payload.(type) {
    case string:
        payload = map[string]string{"message": value}
    case int:
        payload = map[string]int{"value": value}
    case bool:
        payload = map[string]bool{"result": value}
    }
    b, err := json.Marshal(payload)
    if err != nil {
        respondInternalError(w, fmt.Errorf("could not marshal response payload: %v", err))
        return
    }
    w.Header().Set("Content-Type", "application/json; charset=utf-8")
    w.WriteHeader(code)
    w.Write(b)
}
```

First, it does a type assertion for primitive types to wrap they in a `map`. Then it marshalls to JSON, sets the response content type and status code, and writes the JSON. In case the JSON marshalling fails, it respond with an internal error.

### Respond Internal Error Function

`respondInternalError` is a funcion that respond with `500 Internal Server Error`, but it also logs the error to the console.

```go
func respondInternalError(w http.ResponseWriter, err error) {
    log.Println(err)
    respondJSON(w,
        http.StatusText(http.StatusInternalServerError),
        http.StatusInternalServerError)
}
```

### Create User Handler

I'll start coding the `createUser` handler because is the more easy and REST-ish.

```go
type User struct {
    ID       string `json:"id"`
    Email    string `json:"email"`
    Username string `json:"username"`
}
```

The `User` type is just like the `users` table.

```go
var (
    rxEmail = regexp.MustCompile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
    rxUsername = regexp.MustCompile("^[a-zA-Z][\\w|-]{1,17}$")
)
```

These regular expressions are to validate email and username respectively. These are very basic, feel free to adapt they as you need.

Now, **inside** `createUser` function we'll start by decoding the request body.

```go
var user User
if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
    respondJSON(w, err.Error(), http.StatusBadRequest)
    return
}
defer r.Body.Close()
```

We create a JSON decoder using the request body and decode to a user pointer. In case of error we return with a `400 Bad Request`. Don't forget to close the body reader.

```go
errs := make(map[string]string)
if user.Email == "" {
    errs["email"] = "Email required"
} else if !rxEmail.MatchString(user.Email) {
    errs["email"] = "Invalid email"
}
if user.Username == "" {
    errs["username"] = "Username required"
} else if !rxUsername.MatchString(user.Username) {
    errs["username"] = "Invalid username"
}
if len(errs) != 0 {
    respondJSON(w, errs, http.StatusUnprocessableEntity)
    return
}
```

This is how I make validation; a simple `map` and check if `len(errs) != 0` to return with `422 Unprocessable Entity`.

```go
err := db.QueryRowContext(r.Context(), `
    INSERT INTO users (email, username) VALUES ($1, $2)
    RETURNING id
`, user.Email, user.Username).Scan(&user.ID)


if errPq, ok := err.(*pq.Error); ok && errPq.Code.Name() == "unique_violation" {
    if strings.Contains(errPq.Error(), "email") {
        errs["email"] = "Email taken"
    } else {
        errs["username"] = "Username taken"
    }
    respondJSON(w, errs, http.StatusForbidden)
    return
} else if err != nil {
    respondInternalError(w, fmt.Errorf("could not insert user: %v", err))
    return
}
```

This SQL query inserts a new user with the given email and username, and returns the auto generated id. Each `$` will be replaced by the next arguments passed to `QueryRowContext`.

Because the `users` table had unique constraints on the `email` and `username` fields I check for the "unique_violation" error to return with `403 Forbidden` or I return with an internal error.

```go
respondJSON(w, user, http.StatusCreated)
```

Finally I just respond with the created user.

### Passwordless Start Handler

```go
type PasswordlessStartRequest struct {
    Email       string `json:"email"`
    RedirectURI string `json:"redirectUri"`
}
```

This struct holds the `passwordlessStart` request body. The email of the user who wants to log in. The redirect URI comes from the client (the app that will use our API) ex: `https://frontend.app/callback`.

```go
var magicLinkTmpl = template.Must(template.ParseFiles("templates/magic-link.html"))
```

We'll use the golang template engine to build the mailing so I'll need you to create a `magic-link.html` file inside a `templates` directory with a content like so:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Magic Link</title>
</head>
<body>
    Click <a href="{{ .MagicLink }}" target="_blank">here</a> to login.
    <br>
    <em>This link expires in 15 minutes and can only be used once.</em>
</body>
</html>
```

This template is the mail we'll send to the user with the magic link. Feel free to style it how you want.

Now, **inside** `passwordlessStart` function:

```go
var input PasswordlessStartRequest
if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
    respondJSON(w, err.Error(), http.StatusBadRequest)
    return
}
defer r.Body.Close()
```

First, we decode the request body like before.

```go
errs := make(map[string]string)
if input.Email == "" {
    errs["email"] = "Email required"
} else if !rxEmail.MatchString(input.Email) {
    errs["email"] = "Invalid email"
}
if input.RedirectURI == "" {
    errs["redirectUri"] = "Redirect URI required"
} else if u, err := url.Parse(input.RedirectURI); err != nil || !u.IsAbs() {
    errs["redirectUri"] = "Invalid redirect URI"
}
if len(errs) != 0 {
    respondJSON(w, errs, http.StatusUnprocessableEntity)
    return
}
```

For the redirect URI validation we use the golang URL parser and check that the URI is absolute.

```go
var verificationCode string
err := db.QueryRowContext(r.Context(), `
    INSERT INTO verification_codes (user_id) VALUES
        ((SELECT id FROM users WHERE email = $1))
    RETURNING id
`, input.Email).Scan(&verificationCode)
if errPq, ok := err.(*pq.Error); ok && errPq.Code.Name() == "not_null_violation" {
    respondJSON(w, "No user found with that email", http.StatusNotFound)
    return
} else if err != nil {
    respondInternalError(w, fmt.Errorf("could not insert verification code: %v", err))
    return
}
```

This SQL query will insert a new verification code associated with a user with the given email and return the auto generated id. Because the user could not exist, that subquery can resolve to `NULL` which will fail the `NOT NULL` constraint on the `user_id` field so I do a check on that and return with `404 Not Found` in case or an internal error otherwise.

```go
q := make(url.Values)
q.Set("verification_code", verificationCode)
q.Set("redirect_uri", input.RedirectURI)
magicLink := *config.appURL
magicLink.Path = "/api/passwordless/verify_redirect"
magicLink.RawQuery = q.Encode()
```

Now, I build the magic link and set the `verification_code` and `redirect_uri` inside the query string. Ex: `http://localhost/api/passwordless/verify_redirect?verification_code=some_code&redirect_uri=https://frontend.app/callback`.

```go
var body bytes.Buffer
data := map[string]string{"MagicLink": magicLink.String()}
if err := magicLinkTmpl.Execute(&body, data); err != nil {
    respondInternalError(w, fmt.Errorf("could not execute magic link template: %v", err))
    return
}
```

We'll get the magic link template content saving it to a buffer. In case of error I return with an internal error.

```go
to := mail.Address{Address: input.Email}
if err := sendMail(to, "Magic Link", body.String()); err != nil {
    respondInternalError(w, fmt.Errorf("could not mail magic link: %v", err))
    return
}
```

To mail the user I make use of `sendMail` function that I'll code now. In case of error I return with an internal error.

```go
w.WriteHeader(http.StatusNoContent)
```

Finally, I just set the response status code to `204 No Content`. The client doesn't need more data than a success status code.

### Send Mail Function

```go
func sendMail(to mail.Address, subject, body string) error {
    from := mail.Address{
        Name:    "Passwordless Demo",
        Address: "noreply@" + config.appURL.Host,
    }
    headers := map[string]string{
        "From":         from.String(),
        "To":           to.String(),
        "Subject":      subject,
        "Content-Type": `text/html; charset="utf-8"`,
    }
    msg := ""
    for k, v := range headers {
        msg += fmt.Sprintf("%s: %s\r\n", k, v)
    }
    msg += "\r\n"
    msg += body

    return smtp.SendMail(
        config.smtpAddr,
        config.smtpAuth,
        from.Address,
        []string{to.Address},
        []byte(msg))
}
```

This function creates the structure of a basic HTML mail and sends it using the SMTP server. There is a lot of things you can customize of a mail, but I kept it simple.

### Passwordless Verify Redirect Handler

```go
var rxUUID = regexp.MustCompile("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
```

First, this regular expression is to validate an UUID (the verification code).

Now, **inside** `passwordlessVerifyRedirect` function:

```go
q := r.URL.Query()
verificationCode := q.Get("verification_code")
redirectURI := q.Get("redirect_uri")
```

`/api/passwordless/verify_redirect` is a `GET` endpoint so we read data from the query string.

```go
errs := make(map[string]string)
if verificationCode == "" {
    errs["verification_code"] = "Verification code required"
} else if !rxUUID.MatchString(verificationCode) {
    errs["verification_code"] = "Invalid verification code"
}
var callback *url.URL
var err error
if redirectURI == "" {
    errs["redirect_uri"] = "Redirect URI required"
} else if callback, err = url.Parse(redirectURI); err != nil || !callback.IsAbs() {
    errs["redirect_uri"] = "Invalid redirect URI"
}
if len(errs) != 0 {
    respondJSON(w, errs, http.StatusUnprocessableEntity)
    return
}
```

Pretty similar validation, but we store the parsed redirect URI into a `callback` variable.

```go
var userID string
if err := db.QueryRowContext(r.Context(), `
    DELETE FROM verification_codes
    WHERE id = $1
        AND created_at >= now() - INTERVAL '15m'
    RETURNING user_id
`, verificationCode).Scan(&userID); err == sql.ErrNoRows {
    respondJSON(w, "Link expired or already used", http.StatusBadRequest)
    return
} else if err != nil {
    respondInternalError(w, fmt.Errorf("could not delete verification code: %v", err))
    return
}
```

This SQL query deletes a verification code with the given id and makes sure it has been created no more than 15 minutes ago, it also returns the `user_id` associated. In case of no rows, means the code didn't exist or it was expired so we respond with that, otherwise an internal error.

```go
expiresAt := time.Now().Add(time.Hour * 24 * 60)
tokenString, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.StandardClaims{
    Subject:   userID,
    ExpiresAt: expiresAt.Unix(),
}).SignedString(config.jwtKey)
if err != nil {
    respondInternalError(w, fmt.Errorf("could not create JWT: %v", err))
    return
}
```

This is how the JWT is created. We set an expiration date for the JWT within 60 days.
Maybe you can give it less time (~2 weeks) and add a new endpoint to refresh tokens, but I didn't want to add more complexity.

```go
expiresAtB, err := expiresAt.MarshalText()
if err != nil {
    respondInternalError(w, fmt.Errorf("could not marshal expiration date: %v", err))
    return
}
f := make(url.Values)
f.Set("jwt", tokenString)
f.Set("expires_at", string(expiresAtB))
callback.Fragment = f.Encode()
```

We plan to redirect; you could use the query string to add the JWT, but I've seen that a hash fragment is more used. Ex: `https://frontend.app/callback#jwt=token_here&expires_at=some_date`.

The expiration date could be extracted from the JWT, but then the client will have to implement a JWT library to decode it, so to make the life easier I just added it there too.

```go
http.Redirect(w, r, callback.String(), http.StatusFound)
```

Finally we just redirect with a `302 Found`.

---

The passwordless flow is completed. Now we just need to code the `getAuthUser` endpoint which is to get info about the current authenticated user. If you rememeber, this endpoint makes use of `authRequired` middleware.

### With Auth Middleware

Before coding the `authRequired` middleware, I'll code one that doesn't require authentication. I mean, if no JWT is passed, it just continues without authenticating the user.

```go
type ContextKey int

const (
    keyAuthUserID ContextKey = iota
)

func jwtKeyFunc(*jwt.Token) (interface{}, error) {
    return config.jwtKey, nil
}

func withAuth(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        a := r.Header.Get("Authorization")
        hasToken := strings.HasPrefix(a, "Bearer ")
        if !hasToken {
            next(w, r)
            return
        }
        tokenString := a[7:]

        p := jwt.Parser{ValidMethods: []string{jwt.SigningMethodHS256.Name}}
        token, err := p.ParseWithClaims(tokenString, &jwt.StandardClaims{}, jwtKeyFunc)
        if err != nil {
            respondJSON(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
            return
        }

        claims, ok := token.Claims.(*jwt.StandardClaims)
        if !ok || !token.Valid {
            respondJSON(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
            return
        }

        ctx := r.Context()
        ctx = context.WithValue(ctx, keyAuthUserID, claims.Subject)

        next(w, r.WithContext(ctx))
    }
}
```

The JWT will come in every request inside the "Authorization" header in the form of "Bearer &lt;token_here&gt;". So if no token is present, we just pass to the next middleware.

We create a parser and parse the token. If fails, we return with `401 Unauthorized`.

Then we extract the claims inside the JWT and add the `Subject` (which is the user ID) to the request context.

### Auth Required Middleware

```go
func authRequired(next http.HandlerFunc) http.HandlerFunc {
    return withAuth(func(w http.ResponseWriter, r *http.Request) {
        _, ok := r.Context().Value(keyAuthUserID).(string)
        if !ok {
            respondJSON(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
            return
        }
        next(w, r)
    })
}
```

Now, `authRequired` will make use of `withAuth` and will try to extract the authenticated user ID from the request context. If fails, it returns with `401 Unauthorized` otherwise continues.

### Get Auth User

**Inside** `getAuthUser` handler:

```go
ctx := r.Context()
authUserID := ctx.Value(keyAuthUserID).(string)

user, err := fetchUser(ctx, authUserID)
if err == sql.ErrNoRows {
    respondJSON(w, http.StatusText(http.StatusTeapot), http.StatusTeapot)
    return
} else if err != nil {
    respondInternalError(w, fmt.Errorf("could not query auth user: %v", err))
    return
}

respondJSON(w, user, http.StatusOK)
```

First we extract the ID of the authenticated user from the request context, we use that to fetch the user. In case of no row returned, we send a `418 I'm a teapot` or an internal error otherwise.
Lastly we just respond with the user 😊

### Fetch User Function

You saw a `fetchUser` function there.

```go
func fetchUser(ctx context.Context, id string) (User, error) {
    user := User{ID: id}
    err := db.QueryRowContext(ctx, `
        SELECT email, username FROM users WHERE id = $1
    `, id).Scan(&user.Email, &user.Username)
    return user, err
}
```

I decoupled it because fetching a user by ID is a common thing.

---

That's all the code. Build it and test it yourself. You can try a live demo [here](https://go-passwordless-demo.herokuapp.com/).

If you have problems about `Blocked script execution because the document's frame is sandboxed and the 'allow-scripts' permission is not set` after clicking the magic link on mailtrap, try doing a right click + "Open link in new tab". This is a security thing where the mail content is [sandboxed](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#attr-sandbox).
I had this problem sometimes on `localhost`, but I think you should be fine once you deploy the server with `https://`.

Please leave any issues on the [GitHub repo](https://github.com/nicolasparada/go-passwordless-demo) or feel free to send PRs 👍

I'll write a second part for this post coding a client for the API.
