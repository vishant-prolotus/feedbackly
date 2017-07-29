var _ = require('lodash')
var moment = require('moment');
var flow = require('middleware-flow');
var SurveyDevice = require('app-modules/models/surveydevices');
var FeedbackFilter = require('app-modules/models/feedback-filter');

var Fbevent = require('app-modules/models/fbevent');
var validators = require('app-modules/middlewares/validators');
var fbevents = require('app-modules/middlewares/fbevents');
var organizations = require('app-modules/middlewares/organizations');
var questionTypes = require('app-modules/constants/question-types');
var mongoose = require('mongoose')
var counters = require('app-modules/utils/counters');

var UpsellHandler = require('app-modules/utils/upsell-handler');
var NotificationHandler = require('app-modules/utils/notification-handler');

var saveFeedback = require('./feedbacks').saveFeedback

var saveLastFeedback = function(device_id){
  var Device = mongoose.connection.db.collection("devices");
  Device.update({_id: mongoose.Types.ObjectId(device_id)}, {$set: {last_feedback: moment.utc().toDate() }}).then()
}

module.exports = app => {

  app.post('/api/fbevents',
    (req, res, next) => {

      req.body.created_at_adjusted_ts = parseInt(req.body.created_at_adjusted_ts);
      req.body.chain_started_at = parseInt(req.body.chain_started_at);

      if(req.body.created_at_adjusted_ts > moment.utc().add(1, 'days').unix()){
        req.body.created_at_adjusted_ts = moment.utc().unix()
      }

      if(req.body.chain_started_at > moment.utc().add(1, 'days').unix()){
        req.body.chain_started_at= moment.utc().unix()
      }

      if(moment.utc(req.body.created_at).unix() > moment.utc().add(1, 'days').unix()){
        req.body.created_at = moment.utc().toDate();
      }
      

      saveFeedback(req.body);
      saveLastFeedback(req.body.device_id);


      if(req.body.question_type == 'Slider'){
        req.body.data = _.map(req.body.data, d => { return {id: d.id, data: parseFloat(d.data) } } );
      }

      if(['Button', 'NPS'].indexOf(req.body.question_type) > -1){
        req.body.data = _.map(req.body.data, d => parseFloat(d));
      }


      next();
    },
    validators.validateBody({
      _id: { presence: true },
      question_id: { presence: true },
      question_type: { presence: true, inclusion: Object.keys(questionTypes) },
      data: { presence: true, isArray: true },
      feedback_id: { presence: true },
      device_id: { presence: true },
      survey_id: { presence: true },
      created_at_adjusted_ts: { presence: true, timestamp: true },
      organization_id: { presence: true }
    }),
    fbevents.handlePeriodicFbeventCounter(req => req.body),
    fbevents.encryptFbevent(req => req.body),
    (req, res, next) => {
      var upserted = false;
      var feedback = req.fbevent;

      Fbevent.update({ _id: feedback._id }, { $set: Object.assign({}, feedback, { v4: true, period_sequence: req.fbeventPeriod }) }, { upsert: true })
        .then(status => {
          if(status.upserted) {
            upserted = true;
          }

          return Fbevent.findOne({ feedback_id: feedback.feedback_id }).sort('-created_at_adjusted_ts').exec()
        })
        .then(compareFbe => {
          var feedbacks = feedback.feedbacks;

          if(Object.keys(compareFbe.feedbacks).length > Object.keys(feedback.feedbacks)) {
            feedbacks = compareFbe.feedbacks;
          }

          return feedbacks;
        })
        .then(feedbacks => {
          return Fbevent.update({ feedback_id: feedback.feedback_id }, { $set: { feedbacks } }, { multi: true });
        })
        .then(() => {
          if(upserted) {
            counters.increase(counters.getCounterFromFbevent(feedback));
          }

          if(upserted){
            UpsellHandler.handle(req.body);
            NotificationHandler.handle(req.body);
          }

          return res.json({
            _id: feedback._id
          });

        })
        .catch(err => next(err));

        SurveyDevice.update({survey_id: req.body.survey_id, device_id: req.body.device_id}, {$set: {survey_id: req.body.survey_id, device_id: req.body.device_id}}, {upsert: true}).exec()
        FeedbackFilter.update({feedback_id: req.body.feedback_id},{$set: {feedback_id: req.body.feedback_id, [`filters.${req.body.question_id}`]: req.body.data}}, {upsert: true}).exec();
    });

}
