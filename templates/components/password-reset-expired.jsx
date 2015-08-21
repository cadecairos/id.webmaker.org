var React = require('react');
var IconText = require('./icontext.jsx');

var PasswordResetExpired = React.createClass({
  render: function() {
    return (
      <IconText
        className="messageBox"
        iconClass="messageIcon fa fa-exclamation-triangle"
        header="Seems that the link in your email expired."
        headerClass="messageHeader">
          <p>
            Request a new reset password link below
          </p>
      </IconText>
    );
  }
});

module.exports = PasswordResetExpired;
