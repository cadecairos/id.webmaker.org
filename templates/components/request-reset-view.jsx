var React = require('react');
var validators = require('../lib/validatorset');
var Form = require('./form/form.jsx');
var Router = require('react-router');
var WebmakerActions = require('../lib/webmaker-actions.jsx');

var API = require('../lib/api.jsx');

var fields = [
  {
    'email': {
      'placeholder': 'Email',
      'type': 'text',
      'validator': 'email'
    }
  }
];

var fieldsValidators = validators.getValidatorSet(fields);

var RequestResetPassword = React.createClass({
  mixins: [
    Router.Navigation,
    Router.State,
    API
  ],
  componentWillMount: function() {
    WebmakerActions.addListener('FORM_VALIDATION', this.handleFormData);
  },
  componentWillUnmount: function() {
    WebmakerActions.deleteListener('FORM_VALIDATION', this.handleFormData);
  },
  render: function() {
    return (
      <div className="requestPassword innerForm centerDiv">
        <Form onInputBlur={this.handleBlur}
              origin="Reset Password"
              ref="userform"
              fields={fields}
              validators={fieldsValidators}
        />
        <button type="submit" onClick={this.processFormData} className="btn btn-awsm">Set a new password</button>
      </div>
    );
  },
  handleFormData: function(data) {
    this.props.submitForm(data);
  },
  handleBlur: function(fieldName, value) {
    if ( fieldName === 'email' && value ) {
      this.checkUsername(value);
    }
  },
  processFormData: function(e) {
    var form = this.refs.userform;
    form.processFormData(e);
  }
});

module.exports = RequestResetPassword;
