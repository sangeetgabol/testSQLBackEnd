const passport = require("passport");

// Config
const config = require("../config/config");

// Models
const Group = require("../models/Group");
const UserGroup = require("../models/UserGroup");
const Database = require("../models/Database");

const { validationResult } = require("express-validator/check");
let groupSaved = {};
exports.getGroup = (req, res, next) => {
  const { id } = req.params;
  console.log(id);
  Group.findById(id, "title creator", { lean: true }, (err, group) => {
    if (!group) {
      return res.status(404).send("Group not found in the database.");
    }
    console.log(group);

    if (err) return next(err);

    UserGroup.find({ group: id })
      .select("user questions updatedAt")
      .populate("user", "id username")
      .lean()
      .exec((err, allUsersInGroup) => {
        if (err) return next(err);

        let allQuestionsCompleted = 0;

        // I mean, this could change per uer, but the first user is the group owner,
        // so this should be a pretty good guess.
        const totalQuestionsInGroup = allUsersInGroup[0].questions.length;

        const FIFTEEN_MINUTES = 60 * 15 * 1000;

        const questionMetrics = {};
        const setMetrics = {};

        const getQuestionKey = (question, i) =>
          question.title || `${question.set} - Q${i + 1}`;
        console.log(allUsersInGroup);
        // Query returns { user: [{ user : { ... }}]}
        // Below removes the top level "user", resulting in just an array of users.
        // [{ username: ..., ... }, { username: ..., ... }]
        const allUsers = allUsersInGroup.map((userGroupObject, i) => {
          // Active is determined from an action in the last 15 minutes.
          // An action constitutes a questions attempt or joined group.
          const active =
            new Date() - new Date(userGroupObject.updatedAt) < FIFTEEN_MINUTES;

          let questionsCompleted = 0;

          userGroupObject.questions.forEach((question, j) => {
            const questionKey = getQuestionKey(question, j);

            // Check if this question has been recorded before.
            if (!questionMetrics[questionKey]) {
              // If not make the blank metrics detail.
              questionMetrics[questionKey] = {
                index: j + 1,
                title: questionKey,
                set: question.set,
                completed: 0,
              };
            }

            // Now do the same to build the set metrics.
            if (!setMetrics[question.set]) {
              setMetrics[question.set] = {
                index: setMetrics.length + 1,
                set: question.set,
                completed: Number(Boolean(question.completed)),
                total: 1,
              };
            }

            if (Boolean(question.completed)) {
              // If it already exists, increment the completed key.
              questionMetrics[questionKey].completed++;
              setMetrics[question.set].completed++;
              questionsCompleted++;
            }

            // Only record total set questions on the first pass.
            if (i === 0) {
              setMetrics[question.set].total++;
            }
          });

          // Sum the total completed questions.
          allQuestionsCompleted += questionsCompleted;

          return {
            user: userGroupObject,
            username:
              userGroupObject.username === undefined
                ? ""
                : userGroupObject.username,
            updatedAt: userGroupObject.updatedAt,
            active,
            canRemove: !group.creator === userGroupObject._id,
            totalQuestions: userGroupObject.questions.length,
            questionsCompleted,
          };
        });
        console.log(allUsers);
        // Now we have a total numberof questions completed, work out the total.
        const totalQuestions = allUsersInGroup.length * totalQuestionsInGroup;

        // (Completed / Total) * 100 = Percentage complete.
        const averagePercentageComplete =
          (allQuestionsCompleted / totalQuestions) * 100;

        const populatedGroup = {
          id: group._id,
          title: group.title,
          users: allUsers,
          questionMetrics: Object.values(questionMetrics),
          setMetrics: Object.values(setMetrics),
          totalQuestions: totalQuestionsInGroup,
          averagePercentageComplete,
        };

        return res.json(populatedGroup);
      });
  });
};

exports.removeUser = (req, res, next) => {
  const { groupId, userId } = req.params;

  UserGroup.findOneAndRemove({ group: groupId, user: userId }, (err) => {
    if (err) return next(err);

    return res.sendStatus(200);
  });
};

exports.updateGroup = (req, res, next) => {
  const { title } = req.body;
  const { groupId } = req.params;

  Group.findById(groupId, (err, group) => {
    if (err) return next(err);

    if (!group) {
      return res.sendStatus(404);
    }

    group.set("title", title);

    group.save((err, updatedGroup) => {
      if (err) return next(err);

      res.json(group);
    });
  });
};

exports.saveProgress = (req, res, next) => {
  // if (!req.session.group) {
  //   return res.status(400).json({
  //     error: {
  //       message: "You can only save progress when in a group.",
  //     },
  //   });
  // }
  console.log(groupSaved);
  console.log(req.session.userId);
  // If the group doesn't have the question number.
  UserGroup.updateOne(
    { group: groupSaved, user: req.session.userId },
    { questions: req.body.questions },
    (err) => {
      if (err) next(err);

      // Update the group session object.
      req.session.group = {
        ...req.session.group,
        questions: req.body.questions,
      };

      return res.sendStatus(200);
    }
  );
};

exports.listGroups = (req, res, next) => {
  console.log(req.session.userId);
  // Find all the groups that this user is part of so we can exclude them from the list.
  UserGroup.find({ user: req.session.userId }, (err, userGroups) => {
    // Extract all the group id's
    const userGroupsID = userGroups.map((usergroup) => usergroup.group);

    // Construct the query specifying no groups in the users to be selected.
    Group.find()
      .where("_id")
      .nin(userGroupsID)
      .lean()
      .exec((err, groups) => {
        if (err) return next(err);

        return res.json(groups);
      });
  });
};

exports.list = (req, res, next) => {
  Group.find()
    .lean()
    .exec((err, groups) => {
      if (err) return next(err);

      // Make only one query to the database, saved an array of user group progress.
      UserGroup.find({ user: req.session.userId })
        .select("group questions")
        .lean()
        .exec((err, userGroups) => {
          if (err) return next(err);

          if (userGroups.length === 0) {
            return res.send(groups);
          }

          const allGroups = groups.map((group) => {
            // Find any user progress for this group.
            const findUserGroup = userGroups.filter(
              (userGroup) => userGroup.group === group._id
            );

            // If no progress, early out!
            if (findUserGroup.length === 0) {
              return group;
            }

            const groupProgress = findUserGroup[0]["questions"];

            // Get the number of completed questions + total
            const completedQuestions = groupProgress.filter(
              (question) => question.completed
            ).length;

            const totalQuestions = groupProgress.length;

            return {
              ...group,
              isCurrent: Boolean(
                req.session.group && group._id === req.session.group._id
              ),
              canManage: group.creator === req.session.userId,
              completedQuestions,
              totalQuestions,
            };
          });

          return res.send(allGroups);
        });
    });
};

exports.listActive = (req, res, next) => {
  UserGroup.find({ user: req.session.userId })
    .select("group")
    .populate("group", "id title creator")
    .lean()
    .exec((err, usergroups) => {
      if (err) return next(err);

      const userGroupObjects = usergroups.map((usergroup) => ({
        ...usergroup.group,
        canManage: usergroup.group.creator === req.session.userId,
        canLeave: !usergroup.group.creator === req.session.userId,
      }));

      return res.json(userGroupObjects);
    });
};

exports.joinGroup = (req, res, next) => {
  const { id } = req.params;
  // console.log(req.session.userId);
  // Check that this user is not already in this group
  Group.findById(id)
    .select("_id title database")
    .lean()
    .exec((err, group) => {
      if (err) return next(err);

      groupSaved = group;
      console.log("jj", req.session.group);
      UserGroup.findOneAndUpdate(
        { user: req.session.userId, group: id },
        { updatedAt: new Date(), user: req.session.username }
      )
        .select("questions")
        .lean()
        .exec((err, existingUserGroup) => {
          if (err) return next(err);

          // Check if this user has already been in this group or not.
          if (existingUserGroup) {
            // Construct a group object with the users question set.
            const userGroupObject = {
              ...group,
              questions: existingUserGroup.questions,
            };

            // Save the group to the session
            req.session.group = userGroupObject;

            return res.json(userGroupObject);
          } else {
            // If a user group doesn't already exist, create one.
            const obj = new UserGroup({
              user: req.session.userId,
              group: id,
            });

            obj.save((err) => {
              if (err) return next(err);

              // Save the group to the session
              req.session.group = group;

              return res.json(group);
            });
          }
        });
    });
};

exports.createGroup = (req, res, next) => {
  // const errors = validationResult(req);

  // // If there are express errors, extract the error.
  // // As we only expect the title being invalid.
  // if (!errors.isEmpty()) {
  //   const errorMessage = errors.mapped().title.msg;

  //   return res.status(422).json(errorMessage);
  // }

  const { title, databaseID } = req.body;

  // Make sure the database chosen actually exists
  Database.findById(databaseID, (err, database) => {
    if (err) next(err);

    // Create a new group instance
    const obj = new Group({
      title: title,
      creator: req.session.userId,
      database: database.id,
    });
    console.log(obj);
    // req.session.group = obj;
    obj.save((err) => {
      if (err) return next(err);
      console.log(res);
      return res.sendStatus(200);
    });
    // Group.find(title, (err, group) => {
    //   console.log(group);
    //   req.session.group = group;
    // });
  });
};

exports.leaveCurrentGroup = (req, res) => {
  // Just set/remove any current session.
  req.session.group = null;

  return res.sendStatus(200);
};

exports.leaveGroup = (req, res, next) => {
  const { id } = req.params;

  Group.find({ _id: id, creator: req.session.userId }, (err, userOwnsGroup) => {
    if (err) return next(err);

    // Cannot leave your own groups!
    // Must be deleted instead.
    if (userOwnsGroup) {
      return res.status(403).json({
        error: {
          message: "You cannot leave a group that you are the owner of.",
        },
      });
    }

    UserGroup.findOneAndRemove(
      { group: id, user: req.session.userId },
      (err) => {
        if (err) return next(err);

        return res.sendStatus(200);
      }
    );
  });
};

exports.deleteGroup = (req, res, next) => {
  const { id } = req.params;

  Group.findOneAndRemove({ _id: id, creator: req.session.userId }, (err) => {
    if (err) return next(err);

    return res.sendStatus(200);
  });
};
