'use strict';

module.exports = {
    RequestItems : {
        applications :  [
            {
                PutRequest : {
                    Item: {
                        appId: 'marcotest',
                        name: 'Marco Polo = Test1',
                        active: true,
                        facebook: {
                            appId: '186851421741420',
                            verifyToken: '68dfd144f81d7fbdfb8ed6088da7d97e256d90a7',
                            pages: [
                                {
                                    id: '1757069501222687',
                                    name: 'My Test Page2',
                                    token: 'EAACp8LyeYWwBABXdMUCFzvQ3ZBy3rGEZBegV91W6C8qyfzoixZA6tFczrTrZCzWZAU4Ve3Nn4RM8EkCoGo7r19IZC1ZCKZCGeWOeNDKMuQSZBcay7w7EkAPQ3TQBJpSEbGdHeY44WBC14ZCSkNSPPMFBj1DannYc4zEZAoZCralDgRq3qAZDZD'
                                }
                            ]
                        }
                    }
                }
            }
        ]
    }
};
