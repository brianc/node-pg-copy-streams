gulp  = require('gulp')
mocha = require('gulp-mocha')
argv  = require('minimist')(process.argv.slice(2))

gulp.task 'test',  ->
  spec = ['test/**/*_spec.coffee']
  if argv.s
    spec = ['test/setup_spec.coffee']
    spec.push "test/**/#{test}_spec.coffee" for test in argv.s.split ','
    console.dir "Limiting tests to:"
    console.dir spec

  if argv.watch or argv.w
    # Run the tests immediately.
    gulp
      .src(spec, read: false)
      .pipe(mocha(
        reporter: 'min'
        ui: 'bdd'
        growl: true
      ))
      .on('error', (->))

    # Now start the watcher and run them on file changes.
    return gulp
      .watch ['src/**',  'test/**'], ->
        return gulp
          .src(spec, read: false)
          .pipe(mocha(
            reporter: 'min'
            ui: 'bdd'
            growl: true
          ))
          .on('error', (->))

  gulp
    .src(spec, read: false)
    .pipe(mocha(
      reporter: if argv.r then argv.r else 'spec',
      ui: 'bdd'
    ))
