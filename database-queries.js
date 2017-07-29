var mongoose = require('mongoose');
var moment = require('moment');
var Promise = require('bluebird');
var _ = require('lodash');

var utils = require('../results/utils');
var Feedback = require('../../models/feedback');
var Survey = require('../../models/survey');
var Device = require('../../models/device');
var Fbevent = require('../../models/fbevent');
var Question = require('../../models/question');

function getFeedbackCount(options) {
  var dateFrom = moment.utc(options.dateFrom).startOf('day').unix();
  var dateTo = moment.utc(options.dateTo).add(1, 'days').unix();
  var deviceId = _.map(options.deviceId, id => mongoose.Types.ObjectId(id));
  var surveyId = _.map(options.surveyId, id => mongoose.Types.ObjectId(id));

  var match = utils.attachFbeventLimitToQuery(_.get(options, "plan.maxFbeventCount"))({
    chain_started_at: {
      $gte: dateFrom,
      $lt: dateTo
    },
    device_id: { $in: deviceId },
    survey_id: { $in: surveyId }
  });

 var a =Fbevent.aggregate([
    { $match: match },
    { $group: { _id: '$feedback_id' } },
    { $group: { _id: null, count: { $sum: 1 } } }
  ])
  a.options = { allowDiskUse: true, useCursor: true };

  return a.then(aggregation => {
      if(aggregation.length === 0) {
        return 0;
      } else {
        return aggregation[0].count || 0;
      }
    });
}

function getQuestions(options) {
  var questions = {};

  var questionIds = [];

  return new Promise((resolve, reject) => {
    Survey.find({ _id: { $in: options.surveyId  } }, { _id: 0, question_ids: 1 }, function(err, surveys) {
      questionIds = _.chain(surveys)
        .reduce((ids, survey) => ids.concat(survey.question_ids), [])
        .uniq()
        .value();

      var stream = Question.find({ _id: { $in: questionIds }, hidden: { $ne: true } }).stream();

      stream.on('data', chunk => {
        questions [chunk._id.toString()] = chunk;
      });    

      stream.on('end', () => {
        resolve(questions);
      });

      stream.on('error', () => {
        reject();
      });
    });
  });
}

function getFeedbacks(options) {
  var dateFrom = moment.utc(options.dateFrom).startOf('day').unix();
  var dateTo = moment.utc(options.dateTo).add(1, 'days').unix();
  var deviceId = _.map(options.deviceId, id => mongoose.Types.ObjectId(id));
  var surveyId = _.map(options.surveyId, id => mongoose.Types.ObjectId(id));


    var match = { 
    device_id: { $in: deviceId },
    survey_id: { $in: surveyId }
}
  var aggregation = [
    { $match: match },
    { $sort: { created_at_adjusted_ts: -1 } }
  ];

  if(options.skip) {
    aggregation.push({ $skip: options.skip });
  }

  if(options.limit) {
    aggregation.push({ $limit: options.limit });
  }

  var feedbackList = [];
  var feedbacks = []

  return new Promise((resolve, reject) => {

  var cursor=  mongoose.connection.db.collection("feedbacks").aggregate(aggregation, { allowDiskUse: true, cursor: {batchSize: 1000}});
  cursor.on("data", feedback =>{
   feedbacks.push(feedback);
  });
  cursor.on("end", feedback =>{
   resolve(feedbacks);
  })
  })
}


module.exports = { getFeedbacks, getQuestions, getFeedbackCount }
