node-pg-copy-streams
====================

COPY FROM / COPY TO for node-postgres.  Stream from one database to another, and stuff.

## how? what? huh?

Did you know the _all powerful_ PostgreSQL supports streaming binary data directly into and out of a table?
This means you can take your favorite CSV or TSV or whatever format file and pipe it directly into an existing PostgreSQL table.
You can also take a table and pipe it directly to a file, another database, stdout, even to `/dev/null` if you're crazy!

The way I use this usually is to take a table from a production database and replicate it exactly into a dev or local database, but like I said, you can do a lot of funky stuff piping your tables around.  
node.js just happens to be fantastic at piping too. We all win!
