var auth = require('../lib/auth');
var validator = require('../lib/request-validator');
var feedbackList = require('./feedback-list');
var Promise = require('bluebird');
var path = require('path');
var moment = require('moment');
var _ = require('lodash');
var fs = require('fs');
var ejs = require('ejs')
var readFile = Promise.promisify(fs.readFile);
var writeFile = Promise.promisify(fs.writeFile);
var render = require('../lib/render');
var s3Client = require('../lib/s3-client');
var zlib= require('zlib');
var compress = Promise.promisify(zlib.deflate);
var unzip = Promise.promisify(zlib.unzip);
var request = require('request-promise');
var cache = require('../lib/cache');
var ExcelWriter = require('node-excel-stream').ExcelWriter;

function createFile(options) {

  if(options.format === 'xlsx'){

    var titles =[...["Date", "Time", "Feedback Channel"],..._.map(options.data.table.headings, 'title')]
    var headers = titles.map((t,i) => {return {name: t, key: _.camelCase(t)+i, idx: i}})

    var rows = []
    _.forEach(options.data.table.rows, row => {
      var newRow = {}
        _.forEach(row, (item, idx) => {
          var itemKey = _.get(_.find(headers, {idx: idx}), 'key');
          if(!itemKey) return;
          if(typeof item === 'string') var obj = {[itemKey]: item}
          else if (typeof item.toStr === 'string') var obj = {[itemKey]: item.toStr}
          else var obj = {[itemKey]: item.toString()}
          newRow = Object.assign({}, newRow, obj)
        })

        rows.push(newRow);
    })

  let writer = new ExcelWriter({
    sheets: [{
        name: 'Feedbackly',
        key: 'feedbackly',
        headers: headers
    }]
  });

  let dataPromises = rows.map((input) => {
    console.log(input)
    // 'tests' is the key of the sheet. That is used
    // to add data to only the Test Sheet
    return writer.addData('feedbackly', input);
  });
  return Promise.all(dataPromises)
  .then(() => {
      return writer.save();
  })

  }

  if(options.format === 'csv'){
    return readFile(path.join(__dirname, '../../views/print-feedback-list', `${options.format}.ejs`), 'utf-8')
    .then(file => ejs.render(file, { moment, _, data: options.data, dashUrl: process.env.DASH_URL }))
  }

  if(options.format === 'pdf') {
    var pdfServiceUrl = process.env.PDF_SERVICE_URL;
    var url = `${process.env.DASH_SERVICE_URL}/api/feedback-list-pdf/${options.userId}`
    cache.set(`feedback_list_print_payload_${options.userId}`, JSON.stringify(options.data), { ttl: 60 * 3 })
    return request(`${pdfServiceUrl}/?token=feedbackly&address=${url}`)
    .then(url => {
      return url
    })
  }

}


module.exports = app => {

  app.get('/api/feedback-list-pdf/:userId', (req, res) => {
    var id = req.params.userId;
    cache.get(`feedback_list_print_payload_${id}`)
    .then(data => {

      res.render('print-feedback-list/pdf.ejs', { moment, _, data, dashUrl: process.env.DASH_URL });

    }).catch(err => {
      console.log(err)
      res.send('It seems like you found a mysterious error! We are sorry about this. Please try again or contact support at support@feedbackly.com and we will get it sorted.')
    })
  })

  app.post('/api/print-feedback-list',
    auth.isLoggedIn(),
    validator.bodyRequirements(['devices', 'surveys', 'from', 'to']),
    (req, res) => {
      var userId = req.user._id;
      var format = req.query.format;

      if(format === undefined) {
        return res.sendStatus(400);
      }

      var deviceId = req.body.devices
  		var surveyId = req.body.surveys;
  		var dateFrom = req.body.from;
  		var dateTo = req.body.to;
      var language = req.user.settings.locale || 'en';
      var options = {deviceId, surveyId, dateFrom, dateTo, format, language }


      var payloadId = `feedback_list_print_payload_${userId}_${Date.now()}`
      cache.set(payloadId, JSON.stringify(options), { ttl: 60 * 3 })
      return res.json({id: payloadId})


    })

  app.get('/api/print-feedback-list/:id/file',
  auth.isLoggedIn(),
  (req, res) => {
    var id = req.params.id;
    cache.get(id)
    .then(options => {
      feedbackList.getFeedbackTable({ dateFrom: options.dateFrom, dateTo: options.dateTo, deviceId: options.deviceId, surveyId:options.surveyId, language: options.language })
      .then(data => createFile({ format: options.format, data, userId: req.user._id }))
      .then(content => {

        res.set({
          'Content-Type': `application/${options.format}`,
          'Content-Disposition': "attachment; filename=Feedback-list." + options.format,
          "filename": "Feedback-list." + options.format
        });
        if(options.format === 'xlsx') content.pipe(res);
        else res.send(content);
      })
      .catch(err => console.log(err))

    })

  })
}
