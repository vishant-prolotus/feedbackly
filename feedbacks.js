// move to api at some point

var mongoose = require('mongoose')
var oid = mongoose.Types.ObjectId;
var _ = require('lodash')
var moment = require('moment')

function date(d){
  var dd = moment.utc(d).toDate()
  return dd
}

function average(array){
  var len = array.length;
  if(len === 0) return 0;
  var sum = 0;
  array.forEach(i => {sum+=i})
  return sum / len
}

function saveFeedback(fb){
    var data = {[fb.question_type]: { [fb.question_id]: fb.data}}

    var feedbackObj = {
      _id: oid(fb.feedback_id),
      survey_id: oid(fb.survey_id),
      device_id: oid(fb.device_id),
      organization_id: oid(fb.organization_id),
      created_at_adjusted_ts: fb.created_at_adjusted_ts,
      created_at: date(fb.created_at),
      meta: Object.assign({}, (_.get(fb, 'meta_browser') || {}), (_.get(fb, 'meta_query') || {})),
      language: fb.language,
      period_sequence: 0 // TODO: create fbe period counter
    }

    var data;
    if(['Button', 'Word', 'NPS', 'Text', 'Image'].indexOf(fb.question_type) > -1){
      if(['Button', 'NPS', 'Slider'].indexOf(fb.question_type) > -1){
        data = parseFloat(fb.data[0])
      } else data = fb.data[0]
    } else data = fb.data;

    var operations = {
      $setOnInsert: feedbackObj,
      $set: {[`data.${fb.question_type}.${fb.question_id}`]: data},
      $inc: {fbe_count: 1},
      $push: {fbevent_times: date(fb.created_at)}
    }

    if(fb.question_type === 'NPS'){
      operations.$push = Object.assign({}, operations.$push, {'nps': data})
    }

    if(['Button', 'NPS', 'Slider'].indexOf(fb.question_type) > -1){
      var sum = 0;
      if(fb.question_type === 'Slider'){
        sum = average(_.map(fb.data, d => parseFloat(data)))
      } else sum = data
      operations.$inc = Object.assign({},operations.$inc, {sum: sum, avg_count: 1})
    }

    const Feedback = mongoose.connection.db.collection('feedbacks');
    Feedback.update({_id: feedbackObj._id}, operations, {upsert: true}).then()
}


module.exports = { saveFeedback }
