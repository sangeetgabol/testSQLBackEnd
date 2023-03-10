const passport = require("passport");

// Config
const config = require("../config/config");

// Models
const User = require("../models/User");
var session;
const { validationResult } = require("express-validator/check");

exports.login = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(422).send("Invalid username or password");
  }

  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);

    // No user was found.
    if (!user) {
      return res.status(400).send("Invalid username or password");
    }

    req.login(user, (err) => {
      if (err) return next(err);
      session = req.session;
      session.userId = req.user.id;
      session.users = req.user;
      session.username = req.user.username;
      session.group = req.session.group;

      const user = {
        id: req.user.id,
        username: req.user.username,
        group: req.session.group || null,
      };

      return res.json(user);
    });
  })(req, res, next);
};

exports.logout = (req, res) => {
  // Destroy the session
  req.session.destroy();

  // req.logout();

  return res.sendStatus(200);
};

exports.info = (req, res) => {
  // if (req.isAuthenticated()) {
  req.session.users;
  const user = {
    id: req.session.userId,
    username: req.session.username,
    group: req.session.group || null,
  };

  return res.json(user);
  // }

  // return res.sendStatus(403);
};

exports.register = (req, res, next) => {
  // const errors = validationResult(req);

  // if (!errors.isEmpty()) {
  //   return res.status(422).json({ errors: errors.mapped() });
  // }

  User.findOne({ username: req.body.username }, (err, existingUser) => {
    if (err) return next(err);

    if (existingUser) {
      return res.status(400).send("This username already exists.");
    }

    const user = new User({
      username: req.body.username,
      password: req.body.password,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
    });

    user.save((err) => {
      if (err) {
        return next(err);
      }

      req.logIn(user, (err) => {
        if (err) {
          return next(err);
        }

        return res.json({ user: req.user });
      });
    });
  });
};
