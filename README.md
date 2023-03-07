## pg-copy-streams

[![Build Status](https://travis-ci.org/brianc/node-pg-copy-streams.svg)](https://travis-ci.org/brianc/node-pg-copy-streams)

COPY FROM / COPY TO for node-postgres. Stream from one database to another, and stuff.

## how? what? huh?

Did you know that PostgreSQL supports streaming data directly into and out of a table?
This means you can take your favorite CSV or TSV file and pipe it directly into an existing PostgreSQL table.

PostgreSQL supports text, csv/tsv and binary data. If you have data in another format (say for example JSON) convert it to one of the supported format and pipe it directly into an existing PostgreSQL table !

You can also take a table and pipe it directly to a file, another database, stdout, even to `/dev/null` if you're crazy!

What this module gives you is a [Readable](http://nodejs.org/api/stream.html#stream_class_stream_readable) or [Writable](http://nodejs.org/api/stream.html#stream_class_stream_writable) stream directly into/out of a table in your database.
This mode of interfacing with your table is _very fast_ and _very brittle_. You are responsible for properly encoding and ordering all your columns. If anything is out of place PostgreSQL will send you back an error. The stream works within a transaction so you wont leave things in a 1/2 borked state, but it's still good to be aware of.

If you're not familiar with the feature (I wasn't either) you can read this for some good helps: http://www.postgresql.org/docs/9.6/static/sql-copy.html

## examples

### pipe from a table to stdout (copyOut - copy-to)

```js
var { Pool } = require('pg')
var { to as copyTo } = require('pg-copy-streams')

var pool = new Pool()

pool.connect(function (err, client, done) {
  var stream = client.query(copyTo('COPY my_table TO STDOUT'))
  stream.pipe(process.stdout)
  stream.on('end', done)
  stream.on('error', done)
})


// async/await
import { pipeline } from 'node:stream/promises'
import pg from 'pg'
import { to as copyTo } from 'pg-copy-streams'

const pool = new pg.Pool()
const client = await pool.connect()
try {
  const stream = client.query(copyTo('COPY my_table TO STDOUT'))
  await pipeline(stream, process.stdout)
} finally {
  client.release()
}
await pool.end()
```

_Important_: When copying data out of postgresql, postgresql will chunk the data on 64kB boundaries. You should expect rows to be cut across the boundaries of these chunks (the end of a chunk will not always match the end of a row). If you are piping the csv output of postgres into a file, this might not be a problem. But if you are trying to analyse the csv output on-the-fly, you need to make sure that you correctly discover the lines of the csv output across the chunk boundaries. We are not recommending any specific streaming csv parser but `csv-parser` and `csv-parse` seem to correctly handle this.

### pipe from a file to table (copyIn - copy-from)

```js
var fs = require('node:fs')
var { Pool } = require('pg')
var { from as copyFrom } = require('pg-copy-streams')

var pool = new Pool()

pool.connect(function (err, client, done) {
  var stream = client.query(copyFrom('COPY my_table FROM STDIN'))
  var fileStream = fs.createReadStream('some_file.tsv')
  fileStream.on('error', done)
  stream.on('error', done)
  stream.on('finish', done)
  fileStream.pipe(stream)
})


// async/await
import { pipeline } from 'node:stream/promises'
import fs from 'node:fs'
import pg from 'pg'
import { from as copyFrom } from 'pg-copy-streams'

const pool = new pg.Pool()
const client = await pool.connect()
try {
  const ingestStream = client.query(copyFrom('COPY my_table FROM STDIN'))
  const sourceStream = fs.createReadStream('some_file.tsv')
  await pipeline(sourceStream, ingestStream)
} finally {
  client.release()
}
await pool.end()
```

_Note_: In version prior to 4.0.0, when copying data into postgresql, it was necessary to wait for the 'end' event of `pg-copy-streams.from` to correctly detect the end of the COPY operation. This was necessary due to the internals of the module but non-standard. This is not true for versions including and after 4.0.0. The end of the COPY operation must now be detected via the standard 'finish' event. **Users of 4.0.0+ should not wait for the 'end' event because it is not fired anymore.**

In version 6.0.0+, If you have not yet finished ingesting data into a copyFrom stream and you want to ask postgresql to abort the process, you can call `destroy()` on the stream (or let `pipeline` do it for you if it detects an error in the pipeline). This will send a CopyFail message to the backend that will rollback the operation. Please take into account that this will not revert the operation if the CopyDone message has already been sent and is being processed by the backend.

### duplex stream for replication / logical decoding scenarios (copyBoth - copy-both)

This is a more advanded topic.
Check the test/copy-both.js file for an example of how this can be used.

_Note regarding logical decoding_: Parsers for logical decoding scenarios are easier to write when copy-both.js pushes chunks that are aligned on the copyData protocol frames. This is not the default mode of operation of copy-both.js in order to increase the streaming performance. If you need the pushed chunks to be aligned on copyData frames, use the `alignOnCopyDataFrame: true` option.


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

Since version 5.1.0 and the implementation of copy-both.js for logical decoding scenarios, your local postgres instance will need to be configured to accept replication scenarios :

```
postgresql.conf
  wal_level = logical
  max_wal_senders > 0
  max_replication_slots > 0

pg_hba.conf
  make sure your user can connect using the replication mode
```

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

### version 6.0.5 - published 2023-03-07

- improve ejs/cjs Named exports compatibility for easier async/await usage

### version 6.0.4 - published 2022-09-05
### version 6.0.3 - published 2022-09-05

- copy-from: fix issue #136 when the _writev mechanism was triggered with a very large number of chunks

### version 6.0.2 - published 2021-09-13

- copy-from : fix interaction with `pg` optional timeout mechanism

### version 6.0.1 - published 2021-08-23

- Bugfix for node 14+. The order of _destroy / _final calls are different before and after node 14 which caused an issue with the COPY FROM _destroy implementation that appeared in version 6.0.0.

### version 6.0.0 - published 2021-08-20

- Implement _destroy in COPY FROM operations. `pipeline` will automatically send a CopyFail message to the backend is a source triggers an error. cf #115

This version is a major change because some users of the library may have been using other techniques in order to ask the backend to rollback the current operation.

### version 5.1.1 - published 2020-07-21

Bugfix release handling a corner case when an empty stream is piped into copy-from

- fix copy-from.js handling of an empty source

### version 5.1.0 - published 2020-06-07

This version adds a Duplex stream implementation of the PostgreSQL copyBoth mode described on https://www.postgresql.org/docs/9.6/protocol-flow.html. This mode opens the possibility of dealing with replication and logical decoding scenarios.

- implement copy-both.js

### version 5.0.0 - published 2020-05-14

This version's major change is a modification in the COPY TO implementation. The new implementation now extends `Readable` while previous version where extending `Transform`. This should not have an effect on how users use the module but was considered to justify a major version number because even if the test suite coverage is wide, it could have an impact on the streaming dynamics in certain edge cases that are not yet captured by the tests.

- Rewrite copy-to in order to have it extend `Readable` instead of `Transform`


### version 4.0.0 - published 2020-05-11

This version's major change is a modification in the COPY FROM implementation. In previous version, copy-from was internally designed as a `Transform` duplex stream. The user-facing API was writable, and the readable side of the `Transform` was piped into the postgres connection stream to copy the data inside the database.
This led to an issue because `Transform` was emitting its 'finish' too early after the writable side was ended. Postgres had not yet read all the data on the readable side and had not confirmed that the COPY operation was finished. The recommendation was to wait for the 'end' event on the readable side which correcly detected the end of the COPY operation and the fact that the pg connection was ready for new queries.
This recommendation worked ok but this way of detecting the end of a writable is not standard and was leading to different issues (interaction with the `finished` and `pipeline` API for example)
The new copy-from implementation extends writable and now emits 'finish' with the correct timing : after the COPY operation and after the postgres connection has reached the readyForQuery state.
Another big change in this version is that copy-to now shortcuts the core `pg` parsing during the COPY operation. This avoids double-parsing and avoids the fact that `pg` buffers whole postgres protocol messages.

- Rewrite copy-from in order to have it extend `Writable` instead of `Transform`
- Modify copy-to to shortcut the pg protocol parser during the COPY operation
- Add Stream compliance tests for copy-to and copy-from


### version 3.0.0 - published 2020-05-02

This version's major change is a modification in the COPY TO implementation. In the previous versions, a row could be pushed downstream only after the full row was gathered in memory. In many cases, rows are small and this is not an issue. But there are some use cases where rows can grow bigger (think of a row containing a 1MB raw image in a BYTEA field. cf issue #91). In these cases, the library was constantly trying to allocate very big buffers and this could lead to severe performance issues.
In the new implementation, all the data payload received from a postgres chunk is sent downstream without waiting for full row boundaries.

Some users may in the past have relied on the fact the the copy-to chunk boundaries exactly matched row boundaries. A major difference in the 3.x version is that the module does not offer any guarantee that its chunk boundaries match row boundaries. A row data could (and you have to realize that this will happen) be split across 2 or more chunks depending on the size of the rows and on postgres's own chunking decisions.

As a consequence, when the copy-to stream is piped into a pipeline that does row/CSV parsing, you need to make sure that this pipeline correcly handles rows than span across chunk boundaries. For its tests, this module uses the [csv-parser](https://github.com/mafintosh/csv-parser) module

- Add `prettier` configuration following discussion on brianc/node-postgres#2172
- Rewrite the copy-to implementation in order to avoid fetching whole rows in memory
- Use mocha for tests
- Add new tests for copy-to.js focusing on chunk boundaries
- Add integration tests for two streaming csv parsers: csv-parser and csv-parse
- Add eslint
- Add test for quick&dirty bytea binary extraction
- Add benchmark for copy-to in bench/copy-to.js

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
