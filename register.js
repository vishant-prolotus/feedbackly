module.exports = function(app){

  app.get('/register-thx/:passcode', (req, res) => {
    res.render('./../client/registration/thanks.ejs', {passcode: req.params.passcode, channel: {}})
  })

  app.get('/ipad-settings', (req, res) => {
    res.render('./../client/registration/setup.ejs', {channel: {}})
  })
}
