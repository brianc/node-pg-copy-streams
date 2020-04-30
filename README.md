## pg-copy-streams

[![Build Status](https://travis-ci.org/brianc/node-pg-copy-streams.svg)](https://travis-ci.org/brianc/node-pg-copy-streams)

COPY FROM / COPY TO for node-postgres. Stream from one database to another, and stuff.

## how? what? huh?

Did you know the _all powerful_ PostgreSQL supports streaming binary data directly into and out of a table?
This means you can take your favorite CSV or TSV or whatever format file and pipe it directly into an existing PostgreSQL table.
You can also take a table and pipe it directly to a file, another database, stdout, even to `/dev/null` if you're crazy!

What this module gives you is a [Readable](http://nodejs.org/api/stream.html#stream_class_stream_readable) or [Writable](http://nodejs.org/api/stream.html#stream_class_stream_writable) stream directly into/out of a table in your database.
This mode of interfacing with your table is _very fast_ and _very brittle_. You are responsible for properly encoding and ordering all your columns. If anything is out of place PostgreSQL will send you back an error. The stream works within a transaction so you wont leave things in a 1/2 borked state, but it's still good to be aware of.

If you're not familiar with the feature (I wasn't either) you can read this for some good helps: http://www.postgresql.org/docs/9.3/static/sql-copy.html

## examples

### pipe from a table to stdout

```js
var { Pool } = require('pg')
var copyTo = require('pg-copy-streams').to

var pool = new Pool()

pool.connect(function (err, client, done) {
  var stream = client.query(copyTo('COPY my_table TO STDOUT'))
  stream.pipe(process.stdout)
  stream.on('end', done)
  stream.on('error', done)
})
```

### pipe from a file to table

```js
var fs = require('fs')
var { Pool } = require('pg')
var copyFrom = require('pg-copy-streams').from

var pool = new Pool()

pool.connect(function (err, client, done) {
  var stream = client.query(copyFrom('COPY my_table FROM STDIN'))
  var fileStream = fs.createReadStream('some_file.tsv')
  fileStream.on('error', done)
  stream.on('error', done)
  stream.on('end', done)
  fileStream.pipe(stream)
})
```

_Important_: Even if `pg-copy-streams.from` is used as a Writable (via `pipe`), you should not listen for the 'finish' event and expect that the COPY command has already been correctly acknowledged by the database. Internally, a duplex stream is used to pipe the data into the database connection and the COPY command should be considered complete only when the 'end' event is triggered.

## install

```sh
$ npm install pg-copy-streams
```

## notice

This module **only** works with the pure JavaScript bindings. If you're using `require('pg').native` please make sure to use normal `require('pg')` or `require('pg.js')` when you're using copy streams.

Before you set out on this magical piping journey, you _really_ should read this: http://www.postgresql.org/docs/current/static/sql-copy.html, and you might want to take a look at the [tests](https://github.com/brianc/node-pg-copy-streams/tree/master/test) to get an idea of how things work.

Take note of the following warning in the PostgreSQL documentation:

> COPY stops operation at the first error. This should not lead to problems in the event of a COPY TO, but the target table will already have received earlier rows in a COPY FROM. These rows will not be visible or accessible, but they still occupy disk space. This might amount to a considerable amount of wasted disk space if the failure happened well into a large copy operation. You might wish to invoke VACUUM to recover the wasted space.

## benchmarks

The COPY command is commonly used to move huge sets of data. This can put some pressure on the node.js loop, the amount of CPU or the amount of memory used.
There is a bench/ directory in the repository where benchmark scripts are stored. If you have performance issues with `pg-copy-stream` do not hesitate to write a new benchmark that highlights your issue. Please avoid to commit huge files (PR won't be accepted) and find other ways to generate huge datasets.

If you have a local instance of postgres on your machine, you can start a benchmark for example with

```sh
$ cd bench
$ PGPORT=5432 PGDATABASE=postgres node copy-from.js
```

## tests

In order to launch the test suite, you need to have a local instance of postgres running on your machine.

```sh
$ PGPORT=5432 PGDATABASE=postgres make test
```

## contributing

Instead of adding a bunch more code to the already bloated [node-postgres](https://github.com/brianc/node-postgres) I am trying to make the internals extensible and work on adding edge-case features as 3rd party modules.
This is one of those.

Please, if you have any issues with this, open an issue.

Better yet, submit a pull request. I _love_ pull requests.

Generally how I work is if you submit a few pull requests and you're interested I'll make you a contributor and give you full access to everything.

Since this isn't a module with tons of installs and dependent modules I hope we can work together on this to iterate faster here and make something really useful.

## changelog

### version 3.x - not yet published

This version's major change is a modification in the COPY TO implementation. In the previous versions, a row could be pushed downstream only after the full row was gathered in memory. In many cases, rows are small and this is not an issue. But there are some use cases where rows can grow bigger (think of a row containing a 1MB raw image in a BYTEA field. cf issue #91). In these cases, the library was constantly trying to allocate very big buffers and this could lead to severe performance issues.
In the new implementation, all the data payload received from a postgres chunk is sent downstream without waiting for full row boundaries.

Some users may in the past have relied on the fact the the copy-to chunk boundaries exactly matched row boundaries. A major difference in the 3.x version is that the module does not offer any guarantee that its chunk boundaries match row boundaries. A row data could (and you have to realize that this will happen) be split across 2 or more chunks depending on the size of the rows and on postgres's own chunking decisions.

As a consequence, when the copy-to stream is piped into a pipeline that does row/CSV parsing, you need to make sure that this pipeline correcly handles rows than span across chunk boundaries. For its tests, this module uses the [csv-parser](https://github.com/mafintosh/csv-parser) module

- Add `prettier` configuration following discussion on brianc/node-postgres#2172
- Rewrite the copy-to implementation in order to avoid fetching whole rows in memory

### version 2.2.2 - published 2019-07-22

- Bugfix copy-to could pause the client connection, preventing re-use

### version 2.2.1 - published 2019-07-22

- Bugfix copy-from was not correctly unpiped from the the connection stream

### version 2.2.0 - published 2019-03-21

- Small refactor in copy-from passing from 3 push to 2 push in every chunk transform loop
- Add bench/ directory for benchmarks
- Add benchmark to compare performance of pg-copy-stream wrt psql during copy-from
- Add benchmark to measure memory usage of copy-from

### version 2.1.0 - published 2019-03-19

- Change README to stop using the pg pool singleton (removed after pg 7.0)
- Do not register copy-to.pushBufferIfNeeded on the instance itself (avoid dangling method on the object)
- Fix copy-to test wrt intermittent unhandled promise bug
- Add tests regarding client re-use

### version 2.0.0 - published 2019-03-14

This version's major change is a modification in the COPY TO implementation. In the previous version, when a chunk was received from the database, it was analyzed and every row contained within that chunk was pushed individually down the stream pipeline. Small rows could lead to a "one chunk" / "thousands of row pushed" performance issue in node. Thanks to @rafatower & CartoDB for the patch.
This is considered to be a major change since some people could be relying on the fact that each outgoing chunk is an individual row.

Other changes in this version

- Use Strict
- Travis deprecation of old node version (0.12, 0.4). Support LTS 6, 8, 10 and Current 11
- Update dev dependencies (pg, lodash)
- Stop using deprecated Buffer constructor
- Add package-lock.json

## license

The MIT License (MIT)

Copyright (c) 2013 Brian M. Carlson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
