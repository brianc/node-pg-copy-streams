gutil        = require('gulp-util')
prettyHrtime = require('pretty-hrtime')
startTime    = null

module.exports =
  start: ->
    startTime = process.hrtime()
    gutil.log('Running', gutil.colors.green("'bundle'") + '...')

  end: ->
    taskTime = process.hrtime(startTime)
    prettyTime = prettyHrtime(taskTime)
    gutil.log('Finished', gutil.colors.green("'bundle'"), 'in', gutil.colors.magenta(prettyTime))
